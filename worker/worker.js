/**
 * Mirador Los Pinos — review submission Worker.
 *
 * Receives a JSON POST from the public site form, validates it, and creates
 * a GitHub Issue in the site repo so the owner can moderate before the review
 * goes live.
 *
 * Required env vars (Worker → Settings → Variables):
 *   GH_TOKEN            — fine-grained PAT with: Issues = Read & Write
 *                         on the single repo (e.g. user/mirador-pinos).
 *   GH_REPO             — "owner/repo" of the site repo.
 *   ALLOWED_ORIGIN      — exact origin allowed to call this Worker
 *                         (e.g. "https://miradorpinos.com").
 *   TURNSTILE_SECRET    — (optional) Cloudflare Turnstile secret for spam
 *                         protection. If unset, only a honeypot+rate limit
 *                         protect the endpoint.
 *
 * Bind a KV namespace called RATE for IP-based rate limiting (optional but
 * recommended). If not bound, the Worker still works without rate limiting.
 */

const MAX_BODY_BYTES = 8 * 1024;
const RATE_LIMIT_PER_HOUR = 5;

export default {
  async fetch(request, env, ctx) {
    const allowedOrigin = env.ALLOWED_ORIGIN || '*';
    const cors = {
      'Access-Control-Allow-Origin': allowedOrigin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405, cors);
    }

    // Origin check (defence in depth on top of CORS)
    const origin = request.headers.get('Origin') || '';
    if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) {
      return json({ error: 'origin_not_allowed' }, 403, cors);
    }

    // Body size guard
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return json({ error: 'payload_too_large' }, 413, cors);
    }

    let payload;
    try { payload = JSON.parse(raw); }
    catch { return json({ error: 'invalid_json' }, 400, cors); }

    // Honeypot
    if (payload.website) {
      // Pretend success — don't tip off the bot.
      return json({ ok: true }, 200, cors);
    }

    // Validate
    const errors = validate(payload);
    if (errors.length) {
      return json({ error: 'validation_failed', details: errors }, 400, cors);
    }

    // Rate limit by IP (if KV bound)
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    if (env.RATE) {
      const key = `ip:${ip}`;
      const count = parseInt(await env.RATE.get(key) || '0', 10);
      if (count >= RATE_LIMIT_PER_HOUR) {
        return json({ error: 'rate_limited' }, 429, cors);
      }
      await env.RATE.put(key, String(count + 1), { expirationTtl: 3600 });
    }

    // Optional Turnstile verification
    if (env.TURNSTILE_SECRET) {
      const token = (payload.turnstile || '').toString();
      if (!token) return json({ error: 'turnstile_missing' }, 400, cors);
      const ok = await verifyTurnstile(env.TURNSTILE_SECRET, token, ip);
      if (!ok) return json({ error: 'turnstile_failed' }, 400, cors);
    }

    // Create GitHub issue
    if (!env.GH_TOKEN || !env.GH_REPO) {
      return json({ error: 'server_misconfigured' }, 500, cors);
    }

    const issue = buildIssue(payload, { ip, origin, ua: request.headers.get('User-Agent') || '' });
    const ghRes = await fetch(`https://api.github.com/repos/${env.GH_REPO}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.GH_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'mirador-reviews-worker',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(issue),
    });

    if (!ghRes.ok) {
      const text = await ghRes.text();
      console.error('GitHub API error', ghRes.status, text);
      return json({ error: 'github_failed' }, 502, cors);
    }

    return json({ ok: true }, 200, cors);
  },
};

// ─────────────────────────────────────────────────────────────────────────────
function validate(p) {
  const errs = [];
  if (typeof p.author !== 'string' || !p.author.trim() || p.author.length > 80)
    errs.push('author');
  if (!Number.isInteger(p.rating) || p.rating < 1 || p.rating > 5)
    errs.push('rating');
  if (p.title != null && (typeof p.title !== 'string' || p.title.length > 120))
    errs.push('title');
  if (p.body != null && (typeof p.body !== 'string' || p.body.length > 2000))
    errs.push('body');
  if (p.lang && !['es', 'en'].includes(p.lang))
    errs.push('lang');
  return errs;
}

function buildIssue(p, meta) {
  const title = `[Reseña] ${p.rating}★ — ${p.author}${p.title ? `: ${p.title}` : ''}`;

  // Machine-readable block + human-readable summary.
  // The GitHub Action reads the YAML between the markers to update reviews.json.
  const yaml = [
    'author: ' + JSON.stringify(p.author),
    'rating: ' + p.rating,
    'title: ' + JSON.stringify(p.title || ''),
    'lang: ' + JSON.stringify(p.lang || 'es'),
    'body: |',
    ...(p.body || '').split('\n').map(line => '  ' + line),
  ].join('\n');

  const body = [
    '<!-- review-data:start -->',
    '```yaml',
    yaml,
    '```',
    '<!-- review-data:end -->',
    '',
    `> **${p.rating}★ — ${p.author}**${p.title ? ` · *${p.title}*` : ''}`,
    '',
    p.body || '_(no body)_',
    '',
    '---',
    `_lang: ${p.lang || 'es'} · ip: ${meta.ip} · ua: ${meta.ua.slice(0, 120)}_`,
    '',
    '**To approve:** edit the YAML above if needed, then add the `review-approved` label and close the issue. A GitHub Action will append it to `data/reviews.json`.',
    '**To reject:** just close the issue without the label.',
  ].join('\n');

  return {
    title,
    body,
    labels: ['review-pending'],
  };
}

async function verifyTurnstile(secret, token, ip) {
  const form = new URLSearchParams();
  form.set('secret', secret);
  form.set('response', token);
  form.set('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', body: form,
  });
  if (!r.ok) return false;
  const j = await r.json();
  return !!j.success;
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}
