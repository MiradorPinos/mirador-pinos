// ── Config ─────────────────────────────────────────────────────────────────
const CONFIG = {
  // Cloudflare Worker that proxies submissions to GitHub Issues.
  reviewSubmitEndpoint: 'https://mirador-reviews.iker-532.workers.dev',
  // WhatsApp number, international format, no + or spaces.
  whatsappNumber: '524431233903',
};

// ── State ──────────────────────────────────────────────────────────────────
const state = {
  lang: 'es',
  i18n: null,
  reviews: [],
  galleryImages: [],
  lightboxIndex: 0,
};

// ── Boot ───────────────────────────────────────────────────────────────────
(async function init() {
  state.i18n = await fetch('assets/js/i18n.json', { cache: 'no-cache' }).then(r => r.json());
  state.lang = pickInitialLang();

  applyTranslations();
  setupLangToggle();
  setupGallery();
  setupLightbox();
  setupModal();
  setupForm();
  setupWhatsApp();
  setupPlaces();
  setupReviewDetail();
  setupVersionWatcher();

  await loadReviews();
})();

// ── i18n ───────────────────────────────────────────────────────────────────
function pickInitialLang() {
  const saved = localStorage.getItem('mp.lang');
  if (saved && state.i18n[saved]) return saved;
  return 'es'; // default Spanish
}

function t(key) {
  return (state.i18n[state.lang] && state.i18n[state.lang][key]) || key;
}

function applyTranslations() {
  document.documentElement.lang = t('html.lang');
  document.title = t('site.title');

  // Text content
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const attr = el.getAttribute('data-i18n-attr');
    const value = t(key);
    if (attr) {
      el.setAttribute(attr, value);
    } else {
      // Preserve children inside <a class="brand"> etc; only replace text content
      el.textContent = value;
    }
  });

  // Lang toggle indicator
  const active = document.querySelector('[data-lang-active]');
  const inactive = document.querySelector('[data-lang-inactive]');
  if (active && inactive) {
    active.textContent = state.lang.toUpperCase();
    inactive.textContent = (state.lang === 'es' ? 'EN' : 'ES');
  }

  // Copyright with year
  const yearEl = document.getElementById('copyright');
  if (yearEl) yearEl.textContent = t('footer.copyright').replace('{year}', new Date().getFullYear());

  // Re-render reviews so dates and summary change with language
  if (state.reviews.length) renderReviews();
}

function setupLangToggle() {
  const btn = document.getElementById('lang-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    state.lang = state.lang === 'es' ? 'en' : 'es';
    localStorage.setItem('mp.lang', state.lang);
    applyTranslations();
  });
}

// ── Reviews ────────────────────────────────────────────────────────────────
async function loadReviews() {
  try {
    const data = await fetch('data/reviews.json', { cache: 'no-cache' }).then(r => r.json());
    state.reviews = (data.reviews || []).slice().sort((a, b) =>
      (b.date || '').localeCompare(a.date || '')
    );
    renderReviews();
  } catch (e) {
    console.error('Could not load reviews', e);
  }
}

function renderReviews() {
  const grid = document.getElementById('reviews-grid');
  const summary = document.getElementById('reviews-summary');
  if (!grid) return;

  grid.innerHTML = '';

  if (!state.reviews.length) {
    grid.innerHTML = `<p class="muted">${t('reviews.empty')}</p>`;
    summary.textContent = '';
    return;
  }

  const avg = state.reviews.reduce((s, r) => s + (r.rating || 0), 0) / state.reviews.length;
  const stars = '★'.repeat(Math.round(avg)) + '☆'.repeat(5 - Math.round(avg));
  summary.innerHTML = `<span class="stars">${stars}</span>` +
    t('reviews.summary')
      .replace('{rating}', avg.toFixed(1).replace('.', state.lang === 'es' ? ',' : '.'))
      .replace('{count}', state.reviews.length);

  for (const r of state.reviews) {
    grid.appendChild(reviewCard(r));
  }

  setupReviewsCarousel();
}

// ── Reviews carousel (horizontal scroll, snap, nav, dots) ──────────────────
function setupReviewsCarousel() {
  const track = document.getElementById('reviews-grid');
  const prev  = document.getElementById('rc-prev');
  const next  = document.getElementById('rc-next');
  const dots  = document.getElementById('reviews-dots');
  if (!track) return;

  const cards = () => Array.from(track.querySelectorAll('.review-card'));
  const cardStep = () => {
    const c = track.querySelector('.review-card');
    if (!c) return 0;
    const style = getComputedStyle(track);
    const gap = parseFloat(style.columnGap || style.gap || '0');
    return c.getBoundingClientRect().width + gap;
  };
  const hasOverflow = () => track.scrollWidth - track.clientWidth > 4;

  function update() {
    const overflow = hasOverflow();
    if (prev) prev.hidden = !overflow;
    if (next) next.hidden = !overflow;
    if (prev) prev.disabled = track.scrollLeft <= 1;
    if (next) next.disabled = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;

    if (dots) {
      const list = cards();
      const step = cardStep() || 1;
      // How many cards roughly fit in the viewport
      const perView = Math.max(1, Math.round(track.clientWidth / step));
      const pages = Math.max(1, Math.ceil(list.length / perView));
      dots.hidden = !overflow || pages < 2;

      // Rebuild dots if count changed
      if (dots.children.length !== pages) {
        dots.innerHTML = '';
        for (let i = 0; i < pages; i++) {
          const b = document.createElement('button');
          b.type = 'button';
          b.setAttribute('role', 'tab');
          b.setAttribute('aria-label', `Página ${i + 1}`);
          b.addEventListener('click', () => {
            track.scrollTo({ left: i * perView * step, behavior: 'smooth' });
          });
          dots.appendChild(b);
        }
      }
      const active = Math.round(track.scrollLeft / (perView * step));
      Array.from(dots.children).forEach((d, i) =>
        d.setAttribute('aria-selected', i === active ? 'true' : 'false')
      );
    }
  }

  if (prev) prev.onclick = () => track.scrollBy({ left: -cardStep(), behavior: 'smooth' });
  if (next) next.onclick = () => track.scrollBy({ left:  cardStep(), behavior: 'smooth' });

  track.addEventListener('scroll', () => requestAnimationFrame(update), { passive: true });
  window.addEventListener('resize', update);
  update();
}

function reviewCard(r) {
  const card = document.createElement('article');
  card.className = 'review-card';
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', '0');
  card.setAttribute('aria-label', `${t('reviews.read_full')} — ${r.author || '—'}`);

  const stars = '★'.repeat(r.rating || 0) + '☆'.repeat(5 - (r.rating || 0));
  const body = (r.body || '').trim();
  const dateStr = formatDate(r.date);
  card.innerHTML = `
    <div class="review-stars" aria-label="${r.rating} / 5">${stars}</div>
    ${r.title ? `<h3 class="review-title"></h3>` : ''}
    <p class="review-body ${body ? '' : 'empty'}"></p>
    <p class="review-readmore"></p>
    <div class="review-meta">
      <span class="review-author"></span>
      <span class="review-date"></span>
    </div>
  `;
  // textContent everywhere to prevent any HTML in user-submitted content from being interpreted
  if (r.title) card.querySelector('.review-title').textContent = r.title;
  card.querySelector('.review-body').textContent = body || t('reviews.no_body');
  card.querySelector('.review-readmore').textContent = t('reviews.read_full') + ' →';
  card.querySelector('.review-author').textContent = r.author || '—';
  card.querySelector('.review-date').textContent = dateStr;

  const open = () => openReviewDetail(r);
  card.addEventListener('click', open);
  card.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
  return card;
}

// ── Review-detail modal (fullscreen on mobile) ─────────────────────────────
function setupReviewDetail() {
  const rd = document.getElementById('review-detail');
  if (!rd) return;

  rd.querySelectorAll('[data-rd-close]').forEach(btn => {
    btn.addEventListener('click', () => closeReviewDetail());
  });

  document.addEventListener('keydown', e => {
    if (!rd.hidden && e.key === 'Escape') closeReviewDetail();
  });

  // Browser back button → close. We push a history state on open so back()
  // pops it off and triggers popstate, with no URL hash pollution.
  window.addEventListener('popstate', e => {
    if (!rd.hidden) {
      // History already popped — close the modal but DON'T call history.back()
      closeReviewDetail({ skipHistory: true });
    }
  });
}

let _rdOpenerEl = null; // remember which card to refocus on close
function openReviewDetail(r) {
  const rd = document.getElementById('review-detail');
  if (!rd) return;

  // Populate
  const stars = '★'.repeat(r.rating || 0) + '☆'.repeat(5 - (r.rating || 0));
  document.getElementById('rd-stars').textContent  = stars;
  document.getElementById('rd-title').textContent  = r.title || '';
  const bodyEl = document.getElementById('rd-body');
  bodyEl.textContent = (r.body || '').trim() || t('reviews.no_body');
  bodyEl.classList.toggle('empty', !(r.body || '').trim());
  document.getElementById('rd-author').textContent = r.author || '—';
  document.getElementById('rd-date').textContent   = formatDate(r.date);

  // Remember focus origin
  _rdOpenerEl = document.activeElement;

  // Show
  rd.hidden = false;
  rd.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => rd.querySelector('.rd-close')?.focus(), 30);

  // Push history so the back button closes it (without changing the URL)
  history.pushState({ rd: true }, '');
}

function closeReviewDetail({ skipHistory = false } = {}) {
  const rd = document.getElementById('review-detail');
  if (!rd || rd.hidden) return;
  rd.hidden = true;
  rd.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  if (!skipHistory && history.state && history.state.rd) history.back();
  if (_rdOpenerEl && typeof _rdOpenerEl.focus === 'function') {
    setTimeout(() => _rdOpenerEl.focus(), 30);
  }
}

function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  if (isNaN(d)) return iso;
  const locale = state.lang === 'es' ? 'es-MX' : 'en-US';
  return d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}

// ── Gallery + Lightbox ─────────────────────────────────────────────────────
function setupGallery() {
  const items = document.querySelectorAll('#gallery .g-item');
  state.galleryImages = Array.from(items).map(it => it.dataset.img);
  items.forEach((it, i) => {
    it.addEventListener('click', () => openLightbox(i));
  });
}

function setupLightbox() {
  const lb = document.getElementById('lightbox');
  if (!lb) return;
  document.getElementById('lb-close').addEventListener('click', closeLightbox);
  document.getElementById('lb-prev').addEventListener('click', () => moveLightbox(-1));
  document.getElementById('lb-next').addEventListener('click', () => moveLightbox(1));
  lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });
  document.addEventListener('keydown', e => {
    if (lb.hidden) return;
    if (e.key === 'Escape') closeLightbox();
    if (e.key === 'ArrowLeft') moveLightbox(-1);
    if (e.key === 'ArrowRight') moveLightbox(1);
  });
}

function openLightbox(i) {
  state.lightboxIndex = i;
  const lb = document.getElementById('lightbox');
  document.getElementById('lb-img').src = state.galleryImages[i];
  lb.hidden = false;
  document.body.style.overflow = 'hidden';
}
function closeLightbox() {
  document.getElementById('lightbox').hidden = true;
  document.body.style.overflow = '';
}
function moveLightbox(dir) {
  const n = state.galleryImages.length;
  state.lightboxIndex = (state.lightboxIndex + dir + n) % n;
  document.getElementById('lb-img').src = state.galleryImages[state.lightboxIndex];
}

// ── Modal ──────────────────────────────────────────────────────────────────
function setupModal() {
  const modal = document.getElementById('review-modal');
  document.getElementById('open-review-form').addEventListener('click', () => openModal());
  modal.querySelectorAll('[data-close-modal]').forEach(el =>
    el.addEventListener('click', () => closeModal())
  );
  document.addEventListener('keydown', e => {
    if (!modal.hidden && e.key === 'Escape') closeModal();
  });
}
function openModal() {
  const modal = document.getElementById('review-modal');
  modal.hidden = false;
  document.body.style.overflow = 'hidden';
  setTimeout(() => modal.querySelector('input[name="author"]').focus(), 50);
}
function closeModal() {
  const modal = document.getElementById('review-modal');
  modal.hidden = true;
  document.body.style.overflow = '';
  document.getElementById('form-status').textContent = '';
  document.getElementById('form-status').className = 'form-status';
}

// ── Form submission → Worker → GitHub Issue ────────────────────────────────
function setupForm() {
  const form = document.getElementById('review-form');
  const status = document.getElementById('form-status');
  const submitBtn = document.getElementById('submit-btn');
  const bodyEl = document.getElementById('review-body');
  const counter = document.getElementById('body-counter');

  // Live character counter
  if (bodyEl && counter) {
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
    // Honeypot — silently succeed if filled
    if (payload.website) {
      status.classList.add('success');
      status.textContent = t('form.success');
      form.reset();
      return;
    }

    if (!CONFIG.reviewSubmitEndpoint) {
      status.classList.add('error');
      status.textContent = t('form.error') + ' (endpoint not configured)';
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
      status.classList.add('success');
      status.textContent = t('form.success');
      form.reset();
      setTimeout(closeModal, 1800);
    } catch (err) {
      console.error(err);
      status.classList.add('error');
      status.textContent = t('form.error');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = originalLabel;
    }
  });
}

// ── Places of interest ─────────────────────────────────────────────────────
function setupPlaces() {
  document.querySelectorAll('.place[data-map]').forEach(el => {
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'link');
    const open = () => window.open(el.dataset.map, '_blank', 'noopener');
    el.addEventListener('click', open);
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
    });
  });
}

// ── Version watcher ────────────────────────────────────────────────────────
// On every deploy, the GitHub Action writes the commit SHA to /version.txt.
// We poll it occasionally and on tab-focus; when it differs from the version
// the tab loaded with, show a "new version available — refresh" pill so the
// user can blow past any stale CSS/JS in their browser cache.
function setupVersionWatcher() {
  const pill = document.getElementById('version-pill');
  if (!pill) return;
  const refreshBtn = document.getElementById('version-refresh');
  const dismissBtn = document.getElementById('version-dismiss');
  let initial = null;
  let dismissed = false;

  refreshBtn?.addEventListener('click', () => location.reload());
  dismissBtn?.addEventListener('click', () => { pill.hidden = true; dismissed = true; });

  async function check() {
    if (dismissed) return;
    try {
      const r = await fetch('/version.txt', { cache: 'no-store' });
      if (!r.ok) return;
      const v = (await r.text()).trim();
      if (!v) return;
      if (initial === null) { initial = v; return; }
      if (v !== initial) pill.hidden = false;
    } catch (_) { /* offline / network blip — try again later */ }
  }

  // First check on load, then on focus, then every 5 minutes.
  check();
  window.addEventListener('focus', check);
  setInterval(check, 5 * 60 * 1000);
}

// ── WhatsApp ───────────────────────────────────────────────────────────────
function whatsappURL() {
  const msg = encodeURIComponent(t('wa.message'));
  return `https://wa.me/${CONFIG.whatsappNumber}?text=${msg}`;
}

function setupWhatsApp() {
  // Bottom-of-page CTA → direct wa.me deep-link
  const cta = document.getElementById('whatsapp-cta');
  if (cta) {
    cta.target = '_blank';
    cta.rel = 'noopener';
  }

  // Floating widget
  const button = document.getElementById('wa-button');
  const panel = document.getElementById('wa-panel');
  const close = document.getElementById('wa-close');
  const ctaInPanel = document.getElementById('wa-cta');

  function refreshLinks() {
    const url = whatsappURL();
    if (cta) cta.href = url;
    if (ctaInPanel) {
      ctaInPanel.href = url;
      ctaInPanel.target = '_blank';
      ctaInPanel.rel = 'noopener';
    }
  }
  refreshLinks();

  // Update the deep-link whenever the language changes (re-fetches translated msg)
  document.getElementById('lang-toggle')?.addEventListener('click', () => {
    setTimeout(refreshLinks, 0);
  });

  if (!button || !panel) return;

  function openPanel()  { panel.hidden = false; button.setAttribute('aria-expanded', 'true'); }
  function closePanel() { panel.hidden = true;  button.setAttribute('aria-expanded', 'false'); }

  button.addEventListener('click', () => panel.hidden ? openPanel() : closePanel());
  close?.addEventListener('click', closePanel);

  // Close on outside click
  document.addEventListener('click', e => {
    if (panel.hidden) return;
    if (!document.getElementById('wa-widget').contains(e.target)) closePanel();
  });
  // Close on escape
  document.addEventListener('keydown', e => {
    if (!panel.hidden && e.key === 'Escape') closePanel();
  });
}
