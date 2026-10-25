import { describe, expect, it, vi } from 'vitest';
import { boot } from '../src/boot';
import { script, settle, start, tick, useEnv } from './helpers';

const env = useEnv('https://example.com/app');
const names = () => env().events().map((e) => e.name);

describe('track', () => {
  it('sends the event with name, properties, screen = current path, timestamp', async () => {
    const { api } = start();
    api.track('invoice_paid', { amount: 12.5, currency: 'EUR', first: true });
    await api.flush();
    const e = env().events('invoice_paid')[0];
    expect(e).toMatchObject({ name: 'invoice_paid', screen: '/app', properties: { amount: 12.5, currency: 'EUR', first: true }, timestamp: Date.now() });
    expect(e.page).toBeUndefined();
  });

  it('feature and role', async () => {
    const { api } = start();
    api.track('export_done', undefined, { feature: 'reports', role: 'success' });
    api.track('only_role', undefined, { role: 'use' });
    await api.flush();
    expect(env().events('export_done')[0]).toMatchObject({ feature: 'reports', role: 'success' });
    expect(env().events('only_role')[0].role).toBe('use');
  });

  it('drops (never truncates) invalid events with a warning', async () => {
    const { api } = start();
    const bad: [any, any?, any?][] = [
      ['Bad Name'],
      ['$pageview'],
      ['x'.repeat(65)],
      [''],
      [undefined],
      [42],
      ['ok_name', { a: 'y'.repeat(257) }],
      ['ok_name', { a: NaN }],
      ['ok_name', { nested: { a: 1 } }],
      ['ok_name', Object.fromEntries(Array.from({ length: 33 }, (_, i) => ['k' + i, i]))],
      ['ok_name', undefined, { feature: 'Bad Feature' }],
      ['ok_name', undefined, { feature: 'f', role: 'boss' }],
    ];
    for (const args of bad) api.track(...(args as [string]));
    await api.flush();
    expect(names()).toEqual(['$pageview']);
    expect(env().warn.mock.calls.length).toBeGreaterThanOrEqual(bad.length);
  });

  it('accepts the limits exactly', async () => {
    const { api } = start();
    api.track('n'.repeat(64), Object.fromEntries(Array.from({ length: 32 }, (_, i) => ['k' + i, 'v'.repeat(256)])), { feature: 'f'.repeat(64) });
    await api.flush();
    expect(env().events().filter((e) => e.name === 'n'.repeat(64))).toHaveLength(1);
  });
});

describe('feature()', () => {
  it('discovery / start / use / success / failure emit <feature>_<role> with feature and role', async () => {
    const { api } = start();
    const f = api.feature('checkout');
    f.discovery();
    f.start({ cart: 2 });
    f.use();
    f.success({ value: 99 });
    f.failure({ reason: 'card_declined' });
    await api.flush();
    const got = env().events().filter((e) => e.feature);
    expect(got.map((e) => [e.name, e.feature, e.role])).toEqual([
      ['checkout_discovery', 'checkout', 'discovery'],
      ['checkout_start', 'checkout', 'start'],
      ['checkout_use', 'checkout', 'use'],
      ['checkout_success', 'checkout', 'success'],
      ['checkout_failure', 'checkout', 'failure'],
    ]);
    expect(got[3].properties).toEqual({ value: 99 });
  });

  it('use("custom_name", props) names the event explicitly', async () => {
    const { api } = start();
    api.feature('reports').use('report_exported', { format: 'csv' });
    await api.flush();
    expect(env().events('report_exported')[0]).toMatchObject({ feature: 'reports', role: 'use', properties: { format: 'csv' } });
  });

  it('an invalid feature key drops its events with a warning', async () => {
    const { api } = start();
    api.feature('Not Valid').start();
    api.feature('x'.repeat(65)).start();
    api.feature('ok_key').start({ bad: NaN });
    await api.flush();
    expect(names()).toEqual(['$pageview']);
    expect(env().warn).toHaveBeenCalled();
  });
});

describe('never throws', () => {
  it('any misuse of any method is swallowed', async () => {
    const { api } = start({ mode: 'product_analytics' });
    const a = api as any;
    const circular: any = {};
    circular.self = circular;
    const poisoned = Object.defineProperty({}, 'a', {
      enumerable: true,
      get() {
        throw new Error('boom');
      },
    });
    expect(() => {
      a.track();
      a.track(null, null, null);
      a.track('x', circular);
      a.track('x', poisoned);
      a.track('x', 'string-props', 7);
      a.pageview(null);
      a.pageview({});
      a.feature();
      a.feature(null).use();
      a.feature({}).use(Symbol('s'));
      a.identify();
      a.identify(null, 5);
      a.identify('u', poisoned);
      a.optIn();
      a.optOut();
      a.optIn();
      a.sessionId();
      a.reset();
      a('nonsense');
      a(undefined);
      a('version');
      a('hasOwnProperty');
      a('constructor');
    }).not.toThrow();
    await expect(a.flush()).resolves.not.toThrow();
  });

  it('survives broken browser APIs: throwing storage, fetch and console', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
      removeItem: () => {
        throw new Error('x');
      },
    });
    env().warn.mockImplementation(() => {
      throw new Error('console is broken');
    });
    env().fetchMock.mockImplementation(() => {
      throw new Error('fetch is broken');
    });
    const { api } = start({ mode: 'product_analytics' });
    expect(() => {
      api.track('x');
      api.track('Bad');
      api.identify('u');
      api.optOut();
    }).not.toThrow();
    await api.flush();
  });

  it('survives hostile DOM events and a throwing history', async () => {
    const { api } = start();
    const w = env().win as any;
    const doc = w.document;
    expect(() => {
      doc.dispatchEvent(new w.Event('click', { bubbles: true })); // target is the document: no closest()
      doc.body.innerHTML = '<a id="l" href="http://[bad">x</a>';
      doc.getElementById('l').dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
    }).not.toThrow();
    await api.flush();
  });

  it('nothing here produced an unhandled rejection or console error', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { api } = start();
    api.track('x');
    await api.flush();
    expect(err).not.toHaveBeenCalled();
  });
});

describe('command queue stub (window.union.q)', () => {
  const stub = () => {
    const w = env().win as any;
    w.union = function () {
      (w.union.q = w.union.q || []).push(arguments);
    };
    return w;
  };

  it('replays calls made before the script loaded, in order, then the object API works', async () => {
    const w = stub();
    w.union('track', 'early_one', { a: 1 });
    w.union('feature', 'onboarding'); // returns nothing through the stub; must not break the replay
    w.union('track', 'early_two', undefined, { feature: 'onboarding', role: 'start' });
    w.union('pageview', '/virtual');
    boot(script());
    w.union.track('late_one');
    await w.union.flush();
    expect(env().events().map((e) => e.name + '@' + e.screen)).toEqual(['$pageview@/app', 'early_one@/app', 'early_two@/app', '$page_leave@/app', '$pageview@/virtual', 'late_one@/app']);
    expect(env().events('early_two')[0]).toMatchObject({ feature: 'onboarding', role: 'start' });
    expect(w.union.version).toBe('0.2.0');
  });

  it('command style keeps working after load: union("track", ...) and union("feature", key)', async () => {
    const w = stub();
    boot(script());
    w.union('track', 'cmd_style');
    w.union('feature', 'k').success();
    await w.union('flush');
    expect(names()).toEqual(['$pageview', 'cmd_style', 'k_success']);
  });

  it('a bad queued call does not stop the rest', async () => {
    const w = stub();
    w.union('track', 'Not Valid');
    w.union('explode');
    w.union('track', 'fine');
    boot(script());
    await w.union.flush();
    expect(names()).toEqual(['$pageview', 'fine']);
  });

  it('works without any stub: boot installs window.union', async () => {
    boot(script());
    expect(typeof (env().win as any).union.track).toBe('function');
  });
});

describe('loading twice', () => {
  it('the second load is a no-op: same object, one pageview, no duplicate listeners', async () => {
    const w = env().win as any;
    boot(script());
    const first = w.union;
    boot(script({ key: 'av_other' }));
    expect(w.union).toBe(first);
    w.history.pushState({}, '', '/second');
    await first.flush();
    expect(env().events('$pageview').map((e) => e.screen)).toEqual(['/app', '/second']);
    expect(env().fetched.every((b) => b.key === 'av_test')).toBe(true);
  });
});

describe('boot', () => {
  it('without data-key: warns, installs nothing, throws nothing', () => {
    const w = env().win as any;
    expect(() => boot(script({ key: '' }))).not.toThrow();
    expect(w.union).toBeUndefined();
    expect(env().warn).toHaveBeenCalled();
    expect(() => boot(null)).not.toThrow();
  });

  it('finds the attributes of the script: mode, version, api, exclude', async () => {
    const w = env().win as any;
    boot(script({ mode: 'product_analytics', version: '9.9', api: '/_union', exclude: '/app' }));
    w.union.track('x');
    await w.union.flush();
    expect(env().fetchMock).not.toHaveBeenCalled(); // /app is excluded: nothing was recorded
    w.history.pushState({}, '', '/ok');
    w.union.track('y');
    await w.union.flush();
    expect(env().fetchMock.mock.calls[0][0]).toBe('/_union/v1/web');
    expect(env().fetched[0]).toMatchObject({ privacy_mode: 'product_analytics', device: { app_version: '9.9' } });
  });

  it('flush() resolves once the queue is sent', async () => {
    const { api } = start();
    api.track('x');
    const p = api.flush();
    expect(p).toBeInstanceOf(Promise);
    await p;
    expect(env().fetchMock).toHaveBeenCalledTimes(1);
    void settle;
    void tick;
  });
});
