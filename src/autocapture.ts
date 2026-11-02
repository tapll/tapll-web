import type { Core } from './core';
import type { PageContext, Role } from './types';
import { cleanPath } from './validation';

const DOWNLOAD = /\.(pdf|zip|dmg|exe|csv|xlsx|docx|pptx|mp4|mp3|pkg|apk|ipa)$/i;
const UTM = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'] as const;

const bare = (h: string): string => h.toLowerCase().replace(/^www\./, '');

/**
 * Pageviews (load + SPA), `$page_leave`, outbound/download clicks and `data-tapll-event` (or the older `data-union-event`) clicks.
 * Returns the manual `pageview`.
 */
export function startAutocapture(core: Core, track: (name: unknown, props?: unknown, ctx?: { feature?: string; role?: Role }) => void) {
  const w = window;
  const d = document;
  const de = d.documentElement;
  const visible = (): number | null => (d.visibilityState === 'hidden' ? null : Date.now());
  let last: string | undefined;
  let first = true;
  let acc = 0; // visible time banked on the current page
  let since = visible(); // visible since
  let maxScroll = 0;
  let left = false; // a $page_leave was already sent for this visit
  /** Auto-capture never throws into the page. */
  const guard = <A extends any[]>(fn: (...a: A) => void) => (...a: A): void => {
    try {
      fn(...a);
    } catch {
      /* ignore */
    }
  };

  const scroll = (): void => {
    const p = de.scrollHeight > 0 ? Math.round((((w.scrollY || 0) + (w.innerHeight || 0)) / de.scrollHeight) * 100) : 0;
    maxScroll = Math.max(maxScroll, Math.min(100, p));
  };

  function leave(): void {
    if (last === undefined || left) return;
    left = true;
    scroll();
    core.emit('$page_leave', { screen: last, props: { engaged_ms: Math.round(acc + (since === null ? 0 : Date.now() - since)), scroll_pct: maxScroll } });
    acc = 0;
    since = null;
  }

  function context(): PageContext {
    const page: PageContext = { hostname: location.hostname };
    if (first) {
      try {
        const ref = new URL(d.referrer).hostname;
        if (bare(ref) !== bare(location.hostname)) page.referrer = ref;
      } catch {
        /* no or unparsable referrer */
      }
      const sp = new URLSearchParams(location.search);
      for (const k of UTM) {
        const v = sp.get(k);
        if (v && v.length <= 128) page[k] = v;
      }
    }
    return page;
  }

  function pageview(p?: string): void {
    const path = cleanPath(p === undefined ? location.pathname : p);
    if (path === undefined || path === last) return;
    leave();
    last = path;
    left = false;
    acc = maxScroll = 0;
    since = visible();
    const page = context();
    first = false;
    core.emit('$pageview', { screen: path, page });
  }

  // Page lifecycle: leave + beacon when hidden; resume the engagement clock when visible again.
  const hide = guard(() => {
    if (since !== null) acc += Date.now() - since;
    since = null;
    leave();
    core.tx.hide();
  });
  d.addEventListener(
    'visibilitychange',
    guard(() => {
      if (d.visibilityState === 'hidden') hide();
      else (left = false), (since = Date.now());
    }),
  );
  w.addEventListener('pagehide', hide);
  w.addEventListener('scroll', guard(scroll), { passive: true });

  if (core.cfg.spa) {
    const nav = guard(() => pageview());
    for (const m of ['pushState', 'replaceState'] as const) {
      const orig = history[m];
      history[m] = function (this: History, ...a: any[]) {
        const r = (orig as any).apply(this, a);
        nav();
        return r;
      } as any;
    }
    w.addEventListener('popstate', nav);
  }

  d.addEventListener(
    'click',
    guard((e: MouseEvent) => {
      const t = e.target as Element;
      const tag = t.closest('[data-tapll-event],[data-union-event]');
      const attr = (n: string) => (tag && (tag.getAttribute('data-tapll-' + n) || tag.getAttribute('data-union-' + n))) || undefined;
      if (tag) track(attr('event'), undefined, { feature: attr('feature'), role: attr('role') as Role });
      const a = core.cfg.auto && t.closest('a[href]');
      if (!a) return;
      const u = new URL(a.getAttribute('href')!, location.href);
      const ext = DOWNLOAD.exec(u.pathname);
      if (!/^https?:$/.test(u.protocol)) return;
      if (ext) core.emit('$download', { props: { file_ext: ext[1].toLowerCase() } });
      else if (bare(u.hostname) !== bare(location.hostname)) core.emit('$outbound', { props: { url_host: u.hostname } });
    }),
    true,
  );

  pageview();
  return { pageview };
}
