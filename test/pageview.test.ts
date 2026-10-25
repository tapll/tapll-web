import { describe, expect, it, vi } from 'vitest';
import { hide, pagehide, scrollTo, setupEnv, start, teardownEnv, tick, useEnv } from './helpers';

const env = useEnv('https://example.com/start?utm_source=news&utm_medium=email&utm_campaign=c1&utm_term=t&utm_content=ctt&secret=1#frag', { referrer: 'https://www.google.com/search?q=x' });

const push = (url: string) => env().win.history.pushState({}, '', url);

describe('pageviews', () => {
  it('sends a pageview on load with the path only (no query, no hash)', async () => {
    const { api } = start();
    await api.flush();
    const [e] = env().events('$pageview');
    expect(e.screen).toBe('/start');
    expect(JSON.stringify(e)).not.toContain('secret');
    expect(JSON.stringify(e)).not.toContain('frag');
  });

  it('page context on the first pageview: hostname, external referrer host, utm_*', async () => {
    const { api } = start();
    await api.flush();
    expect(env().events('$pageview')[0].page).toEqual({
      hostname: 'example.com',
      referrer: 'www.google.com',
      utm_source: 'news',
      utm_medium: 'email',
      utm_campaign: 'c1',
      utm_term: 't',
      utm_content: 'ctt',
    });
  });

  it('only the first pageview of the page load carries referrer and utm; hostname stays', async () => {
    const { api } = start();
    push('/second?utm_source=again');
    push('/third');
    await api.flush();
    const pv = env().events('$pageview');
    expect(pv.map((e) => e.screen)).toEqual(['/start', '/second', '/third']);
    expect(pv[1].page).toEqual({ hostname: 'example.com' });
    expect(pv[2].page).toEqual({ hostname: 'example.com' });
  });

  it('page context never appears on other events', async () => {
    const { api } = start();
    api.track('thing');
    await api.flush();
    for (const e of env().events().filter((e) => e.name !== '$pageview')) expect(e.page).toBeUndefined();
  });

  it('dedupes the same path (query/hash changes, replaceState to the same path)', async () => {
    const { api } = start();
    push('/start?page=2');
    push('/start#section');
    env().win.history.replaceState({}, '', '/start?x=1');
    api.pageview('/start');
    await api.flush();
    expect(env().events('$pageview')).toHaveLength(1);
  });

  it('SPA: pushState, replaceState to a new path, popstate/back', async () => {
    const unpatched = env().win.history.pushState.bind(env().win.history); // the browser's own back/forward does not go through the patch
    const { api } = start();
    push('/a');
    env().win.history.replaceState({}, '', '/b');
    env().win.history.pushState({}, '', '/c');
    unpatched({}, '', '/b');
    env().win.dispatchEvent(new (env().win as any).PopStateEvent('popstate'));
    await api.flush();
    expect(env().events('$pageview').map((e) => e.screen)).toEqual(['/start', '/a', '/b', '/c', '/b']);
  });

  it('data-spa="false" does not patch history', async () => {
    const orig = env().win.history.pushState;
    const { api } = start({ spa: 'false' });
    expect(env().win.history.pushState).toBe(orig);
    push('/a');
    await api.flush();
    expect(env().events('$pageview')).toHaveLength(1);
  });

  it('manual pageview(path) strips query/hash and still dedupes', async () => {
    const { api } = start();
    api.pageview('/virtual?a=1#b');
    api.pageview('/virtual');
    await api.flush();
    expect(env().events('$pageview').map((e) => e.screen)).toEqual(['/start', '/virtual']);
  });

  it('skips a path longer than 128 chars with a warning, keeps 128', async () => {
    const { api } = start();
    api.pageview('/' + 'x'.repeat(128));
    api.pageview('/' + 'y'.repeat(127));
    await api.flush();
    const screens = env().events('$pageview').map((e) => e.screen);
    expect(screens).toHaveLength(2);
    expect(screens[1]).toHaveLength(128);
    expect(env().warn).toHaveBeenCalled();
  });

  it('referrer: omitted when same site (incl. www), omitted when empty or unparsable', async () => {
    for (const referrer of ['https://example.com/other', 'https://www.example.com/x', '', 'not a url']) {
      teardownEnv();
      vi.useFakeTimers();
      const e2 = setupEnv('https://example.com/p', { referrer });
      const { api } = start();
      await api.flush();
      const e = e2.events('$pageview')[0];
      expect(e.page.referrer, referrer).toBeUndefined();
      expect(e.page.hostname).toBe('example.com');
    }
  });

  it('referrer is the host only, lowercase, no path or query', async () => {
    teardownEnv();
    vi.useFakeTimers();
    const e2 = setupEnv('https://example.com/p', { referrer: 'https://News.Ycombinator.com:8080/item?id=1' });
    const { api } = start();
    await api.flush();
    const e = e2.events('$pageview')[0];
    expect(e.page.referrer).toBe('news.ycombinator.com');
  });

  it('utm values longer than 128 are omitted, empty ones too', async () => {
    teardownEnv();
    vi.useFakeTimers();
    const e2 = setupEnv(`https://example.com/p?utm_source=${'a'.repeat(129)}&utm_medium=${'b'.repeat(128)}&utm_campaign=`);
    const { api } = start();
    await api.flush();
    const page = e2.events('$pageview')[0].page;
    expect(page.utm_source).toBeUndefined();
    expect(page.utm_medium).toHaveLength(128);
    expect(page.utm_campaign).toBeUndefined();
  });

  it('data-exclude suppresses pageviews, custom events and page leaves on those paths', async () => {
    const { api } = start({ exclude: '/start,/admin/*' });
    api.track('hidden_event');
    push('/public');
    api.track('visible_event');
    push('/admin/users');
    api.track('also_hidden');
    hide(env());
    await tick(0);
    await api.flush();
    const seen = env().events().map((e) => `${e.name}@${e.screen}`);
    expect(seen).toEqual(['$pageview@/public', 'visible_event@/public', '$page_leave@/public']);
  });
});

describe('$page_leave', () => {
  it('on hidden: engaged_ms (visible time only) and scroll_pct, screen = path', async () => {
    const win = env().win as any;
    Object.defineProperty(win.document.documentElement, 'scrollHeight', { value: 4000, configurable: true });
    const { api } = start();
    await tick(10_000);
    scrollTo(env(), 1000); // viewport 800 -> bottom edge at 1800 / 4000 = 45%
    scrollTo(env(), 0); // scrolling back up does not lower the depth
    await tick(5_000);
    hide(env());
    await tick(0);
    expect(env().beacon).toHaveBeenCalled();
    const [l] = env().events('$page_leave');
    expect(l.screen).toBe('/start');
    expect(l.properties).toEqual({ engaged_ms: 15000, scroll_pct: 45 });
    void api;
  });

  it('does not count time while hidden, and a second visit sends a second leave', async () => {
    start();
    await tick(4_000);
    hide(env());
    await tick(60_000);
    hide(env(), 'visible');
    await tick(3_000);
    hide(env());
    await tick(0);
    expect(env().events('$page_leave').map((e) => e.properties.engaged_ms)).toEqual([4000, 3000]);
  });

  it('visibilitychange followed by pagehide sends one leave', async () => {
    start();
    await tick(1000);
    hide(env());
    pagehide(env());
    await tick(0);
    expect(env().events('$page_leave')).toHaveLength(1);
  });

  it('pagehide alone also sends the leave and flushes by beacon', async () => {
    start();
    await tick(2000);
    pagehide(env());
    await tick(0);
    expect(env().beacon).toHaveBeenCalledTimes(1);
    expect(env().events('$page_leave')[0].properties.engaged_ms).toBe(2000);
  });

  it('is sent before an SPA navigation for the previous path, then the new pageview', async () => {
    const { api } = start();
    await tick(7_000);
    env().win.history.pushState({}, '', '/next');
    await api.flush();
    expect(env().events().map((e) => `${e.name}@${e.screen}`)).toEqual(['$pageview@/start', '$page_leave@/start', '$pageview@/next']);
    expect(env().events('$page_leave')[0].properties).toEqual({ engaged_ms: 7000, scroll_pct: 0 });
  });

  it('scroll_pct is an integer in 0-100', async () => {
    const win = env().win as any;
    Object.defineProperty(win.document.documentElement, 'scrollHeight', { value: 900, configurable: true });
    start();
    scrollTo(env(), 5000);
    hide(env());
    await tick(0);
    expect(env().events('$page_leave')[0].properties.scroll_pct).toBe(100);
  });
});
