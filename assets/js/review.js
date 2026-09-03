// Standalone review page (QR target at /reviews/).
// Self-contained: shares i18n.json and the Worker endpoint with the main
// site, but carries none of the homepage's gallery / carousel / widget logic.

const CONFIG = {
  reviewSubmitEndpoint: 'https://mirador-reviews.iker-532.workers.dev',
};

const state = { lang: 'es', i18n: null };

(async function init() {
  state.i18n = await fetch('/assets/js/i18n.json', { cache: 'no-cache' }).then(r => r.json());
  state.lang = pickInitialLang();

  applyTranslations();
  setupLangToggle();
  setupCharCounter();
  setupForm();
})();

// ── i18n ────────────────────────────────────────────────────────────────────
// Default to Spanish — the site's canonical language — regardless of the
// visitor's browser/OS locale, so it matches the homepage (/ = es, /en/ = en).
// English is opt-in only, via ?lang=en (the toggle, or an EN-specific QR).
function pickInitialLang() {
  return new URLSearchParams(location.search).get('lang') === 'en' ? 'en' : 'es';
}

function t(key) {
  return (state.i18n[state.lang] && state.i18n[state.lang][key]) || key;
}

function applyTranslations() {
  document.documentElement.lang = t('html.lang');
  document.title = t('review.page_title');

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const attr = el.getAttribute('data-i18n-attr');
    const value = t(key);
    if (attr) el.setAttribute(attr, value);
    else el.textContent = value;
  });

  const active = document.querySelector('[data-lang-active]');
  const inactive = document.querySelector('[data-lang-inactive]');
  if (active && inactive) {
    active.textContent = state.lang.toUpperCase();
    inactive.textContent = state.lang === 'es' ? 'EN' : 'ES';
  }
}

function setupLangToggle() {
  const btn = document.getElementById('lang-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    state.lang = state.lang === 'es' ? 'en' : 'es';
    applyTranslations();
    // Reflect the choice in the URL without reloading.
    const url = new URL(location.href);
    url.searchParams.set('lang', state.lang);
    history.replaceState(null, '', url);
  });
}

// ── Character counter ────────────────────────────────────────────────────────
function setupCharCounter() {
  const bodyEl = document.getElementById('review-body');
  const counter = document.getElementById('body-counter');
  if (!bodyEl || !counter) return;
  const max = parseInt(bodyEl.getAttribute('maxlength'), 10) || 711;
  const update = () => {
    const len = bodyEl.value.length;
    counter.textContent = `${len} / ${max}`;
    counter.classList.toggle('near-limit', len > max * 0.85 && len < max);
    counter.classList.toggle('at-limit', len >= max);
  };
  bodyEl.addEventListener('input', update);
  update();
}

// ── Form submission → Worker → GitHub Issue ──────────────────────────────────
function setupForm() {
  const form = document.getElementById('review-form');
  const status = document.getElementById('form-status');
  const submitBtn = document.getElementById('submit-btn');
  const success = document.getElementById('rp-success');
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();
    status.className = 'form-status';
    status.textContent = '';

    const fd = new FormData(form);
    const payload = {
      author: (fd.get('author') || '').toString().trim(),
      rating: Number(fd.get('rating')) || 0,
      title: (fd.get('title') || '').toString().trim(),
      body: (fd.get('body') || '').toString().trim(),
      website: (fd.get('website') || '').toString(), // honeypot
      lang: state.lang,
    };

    if (!payload.author || payload.rating < 1 || payload.rating > 5) {
      status.classList.add('error');
      status.textContent = t('form.error');
      return;
    }
    // Honeypot — silently succeed if filled.
    if (payload.website) {
      showSuccess();
      return;
    }

    submitBtn.disabled = true;
    const originalLabel = submitBtn.textContent;
    submitBtn.textContent = t('form.submitting');

    try {
      const res = await fetch(CONFIG.reviewSubmitEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      showSuccess();
    } catch (err) {
      console.error(err);
      status.classList.add('error');
      status.textContent = t('form.error');
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });

  function showSuccess() {
    form.hidden = true;
    if (success) success.hidden = false;
  }
}
