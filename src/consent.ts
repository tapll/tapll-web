/**
 * Union's own consent banner (`consent.js`), loaded by `u.js` only for `data-consent="banner"` while the
 * visitor has not answered, or by `union.showConsent()`. Kept out of `u.js` so sites that do not need it
 * pay nothing for it.
 *
 * Accept and Decline carry equal weight — same size, same style, same order every time: an EU banner
 * that makes refusal harder than acceptance is not consent. The banner renders in a shadow root so the
 * site's CSS cannot restyle it and its CSS cannot leak into the site. Its text is the site's to set:
 * `data-consent-text`, `data-consent-accept`, `data-consent-decline`, `data-consent-policy` (a URL) on
 * the `u.js` script tag.
 */
const TEXT = 'We use privacy-friendly analytics to understand how this site is used. It stores an anonymous ID in your browser.';

function show(): void {
  const doc = document;
  if (doc.getElementById('union-consent')) return;
  const tag = doc.querySelector('script[data-key][data-consent]') || doc.querySelector('script[data-key]');
  const a = (n: string, d: string): string => ((tag && tag.getAttribute('data-consent-' + n)) || '').trim() || d;
  const policy = a('policy', '');

  const host = doc.createElement('div');
  host.id = 'union-consent';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML =
    '<style>' +
    ':host{all:initial}' +
    '.b{position:fixed;z-index:2147483646;left:16px;right:16px;bottom:16px;max-width:560px;margin:0 auto;box-sizing:border-box;' +
    'padding:16px;border-radius:12px;background:#fff;color:#111;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
    'box-shadow:0 8px 32px rgba(0,0,0,.18);display:flex;flex-wrap:wrap;gap:12px;align-items:center}' +
    '.t{flex:1 1 260px;margin:0}.t a{color:inherit}' +
    '.a{display:flex;gap:8px}' +
    'button{font:inherit;font-weight:600;padding:8px 16px;border-radius:8px;border:1px solid currentColor;background:transparent;color:inherit;cursor:pointer;min-width:96px}' +
    'button:focus-visible{outline:2px solid #2f5bff;outline-offset:2px}' +
    '@media (prefers-color-scheme:dark){.b{background:#1c1c1e;color:#f2f2f2}}' +
    '</style>' +
    '<div class="b" role="region" aria-label="Privacy choice">' +
    '<p class="t"></p>' +
    '<div class="a"><button type="button" data-v="0"></button><button type="button" data-v="1"></button></div>' +
    '</div>';
  const p = root.querySelector('.t')!;
  p.textContent = a('text', TEXT) + ' ';
  if (/^https?:\/\//.test(policy)) {
    const link = doc.createElement('a');
    link.href = policy;
    link.textContent = 'Privacy policy';
    p.appendChild(link);
  }
  const [decline, accept] = Array.from(root.querySelectorAll('button'));
  decline!.textContent = a('decline', 'Decline');
  accept!.textContent = a('accept', 'Accept');
  root.addEventListener('click', (ev) => {
    const v = (ev.target as Element).getAttribute && (ev.target as Element).getAttribute('data-v');
    if (v === null) return;
    try {
      (window as any).union('consent', v === '1');
    } catch {
      /* never throw into the page */
    }
    host.remove();
  });
  doc.body.appendChild(host);
}

try {
  (window as any).__unionConsent = show;
  if (document.body) show();
  else document.addEventListener('DOMContentLoaded', show);
} catch {
  /* never throw into the page */
}
