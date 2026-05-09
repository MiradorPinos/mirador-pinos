# Mirador Los Pinos — site

Static site for [miradorpinos.com](https://miradorpinos.com), hosted on GitHub Pages.

## Stack

- Vanilla HTML / CSS / JS — no build step.
- ES + EN i18n via a single `i18n.json`.
- Reviews stored in `data/reviews.json` (committed to the repo).
- Review submissions go through a tiny Cloudflare Worker that opens a GitHub Issue. You moderate the issue, label it `review-approved`, close it, and a GitHub Action appends it to `reviews.json` and pushes — which auto-redeploys the site.

## Folder layout

```
.
├── index.html
├── CNAME                       # custom-domain marker for GitHub Pages
├── assets/
│   ├── css/style.css
│   └── js/
│       ├── main.js             # i18n, lightbox, reviews render, form submit
│       └── i18n.json           # ES + EN strings
├── data/
│   └── reviews.json            # source of truth for reviews
├── images/                     # photos (renamed from the old WP uploads)
├── worker/                     # Cloudflare Worker for review submission
│   ├── worker.js
│   └── wrangler.toml
└── .github/workflows/
    └── sync-approved-reviews.yml
```

## Local preview

Anything that serves static files works:

```bash
cd /path/to/this/repo
python3 -m http.server 8080
# open http://localhost:8080
```

(Opening `index.html` via `file://` won't work — `fetch()` for `i18n.json` and `reviews.json` needs a real server.)

## Editing content

| What | Where |
|---|---|
| Site copy (ES + EN) | `assets/js/i18n.json` |
| Cabin photos | drop into `images/`, reference in `index.html` |
| Places-of-interest copy | `assets/js/i18n.json` (`nearby.*` keys) |
| Place photos | `images/place-*.jpg` (referenced inline in `index.html`) |
| Place map links | `data-map="..."` on each `<article class="place">` |
| Existing reviews | `data/reviews.json` |
| Theme colours, fonts | top of `assets/css/style.css` (CSS custom properties) |
| WhatsApp number | `assets/js/main.js` → `CONFIG.whatsappNumber` |
| WhatsApp greeting / button text | `assets/js/i18n.json` → `wa.*` keys |

GitHub has a web editor — press `.` on the repo page to edit any file in-browser. Commit on `main` and Pages redeploys in ~30 seconds.

---

## Deployment

### 1. Push to GitHub

Create a public repo (e.g. `mirador-pinos`) and push these files to `main`.

### 2. Enable Pages

Repo → **Settings → Pages**:
- Source: **Deploy from a branch**
- Branch: `main` / `/ (root)`
- Custom domain: `miradorpinos.com`
- Tick **Enforce HTTPS** once it's available.

### 3. DNS

At your domain registrar:

| Type | Name | Value |
|---|---|---|
| A | `@` | `185.199.108.153` |
| A | `@` | `185.199.109.153` |
| A | `@` | `185.199.110.153` |
| A | `@` | `185.199.111.153` |
| CNAME | `www` | `<your-username>.github.io.` |

GitHub will provision a Let's Encrypt cert automatically (can take up to ~1h after DNS propagates).

### 4. Decommission InfinityFree

Once the new site is live and verified, cancel the old hosting. Keep a copy of the WP DB credentials somewhere safe (in case you ever want to dig out historical data).

---

## Review-submission infrastructure

### A. Create a fine-grained GitHub PAT

GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens** → **Generate new token**:

- **Resource owner**: your account
- **Repository access**: only the `mirador-pinos` repo
- **Repository permissions**:
  - **Issues**: Read and write
  - (everything else: No access)
- **Expiration**: 1 year is reasonable; set a calendar reminder.

Copy the token (starts with `github_pat_…`).

### B. Deploy the Worker

```bash
cd worker
npm install -g wrangler           # one-time
wrangler login

# 1. Edit wrangler.toml — set GH_REPO and ALLOWED_ORIGIN to real values.
# 2. Push the GitHub token as a secret:
wrangler secret put GH_TOKEN
#    → paste the github_pat_… token

# 3. (Optional) create the rate-limit KV namespace:
wrangler kv:namespace create RATE
#    → paste the printed `id` into wrangler.toml under [[kv_namespaces]]

# 4. Deploy:
wrangler deploy
```

The output prints a URL like `https://mirador-reviews.<your-account>.workers.dev`.

### C. Wire the site to the Worker

Edit `assets/js/main.js`:

```js
const CONFIG = {
  reviewSubmitEndpoint: 'https://mirador-reviews.<your-account>.workers.dev',
  ...
};
```

Commit + push.

### D. Optional: spam protection

If reviews start attracting spam, add Cloudflare Turnstile:

1. Cloudflare dashboard → **Turnstile** → create a site → get the **site key** + **secret key**.
2. `wrangler secret put TURNSTILE_SECRET` (paste the secret key).
3. Add the Turnstile widget to the form in `index.html` and include the token in the submission payload as `turnstile`.

The honeypot field + per-IP rate limit (5/h via the KV namespace) cover most of it without Turnstile.

### E. Moderation flow

1. Visitor submits form on the site.
2. Worker validates → opens an issue labelled `review-pending`.
3. You get a GitHub notification.
4. Read the issue. Edit the YAML block at the top if you want to fix typos / change the displayed name.
5. **To approve**: add the label `review-approved`, then close the issue.
6. **To reject**: just close the issue.
7. The Action `sync-approved-reviews.yml` runs on close, appends the approved entries to `data/reviews.json`, and pushes. Pages redeploys. Review live in ~1 minute.

You'll need to create the two labels once: **Issues → Labels → New label** → `review-pending` and `review-approved`.

---

## Notes

- **Don't** commit anything from the old `wp-config.php` — that file contains live DB credentials. Keep it separate from this repo.
- The five **place photos** (`images/place-*.jpg`) are from **Wikimedia Commons under CC BY-SA 4.0** — the section credits them in the footer of that section. If you replace them with your own photos, you can drop the credit line (delete the `nearby.credits` keys from `i18n.json` and the `<p class="muted small center" data-i18n="nearby.credits">` from `index.html`).
- The WhatsApp widget is built-in (no third-party script). It opens `https://wa.me/<number>?text=<message>` — works on mobile, desktop, and WhatsApp Web. To change number/message edit `CONFIG.whatsappNumber` in `assets/js/main.js` and the `wa.message` keys in `i18n.json`.
- All review user input is rendered via `textContent`, so any HTML/JS in submitted bodies is rendered as plain text — XSS-safe.
