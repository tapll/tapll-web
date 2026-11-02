/**
 * Tapll's own consent banner (`consent.js`), loaded by `u.js` only for `data-consent="banner"` while the
 * visitor has not answered, or by `tapll.showConsent()`. Kept out of `u.js` so sites that do not need it
 * pay nothing for it.
 *
 * Accept and Decline carry equal weight — same size, same style, same order every time: an EU banner
 * that makes refusal harder than acceptance is not consent. The banner renders in a shadow root so the
 * site's CSS cannot restyle it and its CSS cannot leak into the site. Its text is the site's to set:
 * `data-consent-title`, `data-consent-text`, `data-consent-accept`, `data-consent-decline`, `data-consent-policy` (a URL) on
 * the `u.js` script tag.
 */
const TITLE = 'Your privacy';
const TEXT = 'We use privacy-friendly analytics to understand how this site is used. It stores an anonymous ID in your browser.';

function show(): void {
  const doc = document;
  if (doc.getElementById('tapll-consent')) return;
  const tag = doc.querySelector('script[data-key][data-consent]') || doc.querySelector('script[data-key]');
  const a = (n: string, d: string): string => ((tag && tag.getAttribute('data-consent-' + n)) || '').trim() || d;
  const policy = a('policy', '');

  const host = doc.createElement('div');
  host.id = 'tapll-consent';
  const root = host.attachShadow({ mode: 'open' });
  // A quiet card: bottom-left on wide screens, a full-width sheet on phones. Both buttons share one class,
  // so neither can look like the "right" answer.
  root.innerHTML =
    '<style>' +
    ':host{all:initial}' +
    '.b{--bg:#fff;--fg:#18181b;--mute:#52525b;--line:rgba(24,24,27,.08);--btn:#f4f4f5;--btnh:#e4e4e7;' +
    'position:fixed;z-index:2147483646;left:16px;bottom:16px;width:min(380px,calc(100vw - 32px));box-sizing:border-box;' +
    'padding:18px;border-radius:16px;background:var(--bg);color:var(--fg);border:1px solid var(--line);' +
    'font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;' +
    'box-shadow:0 1px 2px rgba(0,0,0,.04),0 12px 40px -8px rgba(0,0,0,.18);animation:in .32s cubic-bezier(.2,.8,.2,1)}' +
    '.h{display:flex;align-items:center;gap:8px;margin:0 0 6px;font-weight:600;font-size:14px}' +
    '.h svg{flex:none;color:var(--mute)}' +
    '.t{margin:0 0 14px;color:var(--mute);font-size:13px}' +
    '.t a{color:var(--fg);text-decoration:underline;text-decoration-color:var(--line);text-underline-offset:3px;white-space:nowrap}' +
    '.t a:hover{text-decoration-color:currentColor}' +
    '.a{display:grid;grid-template-columns:1fr 1fr;gap:8px}' +
    'button{font:inherit;font-weight:600;font-size:13px;padding:9px 12px;border-radius:10px;border:0;' +
    'background:var(--btn);color:var(--fg);cursor:pointer;transition:background .15s}' +
    'button:hover{background:var(--btnh)}' +
    'button:focus-visible{outline:2px solid #3b82f6;outline-offset:2px}' +
    '@media (max-width:480px){.b{left:8px;bottom:8px;width:calc(100vw - 16px)}}' +
    '@media (prefers-color-scheme:dark){.b{--bg:#18181b;--fg:#fafafa;--mute:#a1a1aa;--line:rgba(255,255,255,.1);--btn:#27272a;--btnh:#3f3f46;' +
    'box-shadow:0 12px 40px -8px rgba(0,0,0,.6)}}' +
    '@keyframes in{from{opacity:0;transform:translateY(12px) scale(.98)}}' +
    '@media (prefers-reduced-motion:reduce){.b{animation:none}}' +
    '</style>' +
    '<div class="b" role="region" aria-label="Privacy choice">' +
    '<p class="h"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M12 3l7 3v5c0 4.5-3 8.3-7 9.5C8 19.3 5 15.5 5 11V6z"/></svg><span></span></p>' +
    '<p class="t"></p>' +
    '<div class="a"><button type="button" data-v="0"></button><button type="button" data-v="1"></button></div>' +
    '</div>';
  root.querySelector('.h span')!.textContent = a('title', TITLE);
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
      (window as any).tapll('consent', v === '1');
    } catch {
      /* never throw into the page */
    }
    host.remove();
  });
  doc.body.appendChild(host);
}

try {
  (window as any).__tapllConsent = show;
  if (document.body) show();
  else document.addEventListener('DOMContentLoaded', show);
} catch {
  /* never throw into the page */
}
