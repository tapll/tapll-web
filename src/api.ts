import { startAutocapture } from './autocapture';
import { createCore } from './core';
import type { Config, Properties, Role } from './types';
import { cleanProps, cleanTraits, isName, isUserId, ROLES, warn } from './validation';
import { VERSION } from './version';

export type FeatureHandle = Record<Role, (propsOrName?: Properties | string, props?: Properties) => void>;

export interface Union {
  (command: string, ...args: unknown[]): unknown;
  readonly version: string;
  track(name: string, props?: Properties, context?: { feature?: string; role?: Role }): void;
  pageview(path?: string): void;
  feature(key: string): FeatureHandle;
  identify(userId: string, traits?: Record<string, string>): void;
  reset(): void;
  optOut(): void;
  optIn(): void;
  sessionId(): string | null;
  flush(): Promise<void>;
}

/**
 * Builds the public `union` function/object for one config and starts auto-capture.
 * Every method goes through the one dispatcher below, so nothing ever throws into the page.
 */
export function createApi(cfg: Config) {
  const core = createCore(cfg);
  const pa = cfg.mode === 'product_analytics';

  const track = (name: unknown, props?: unknown, ctx?: { feature?: string; role?: Role }): void => {
    const { feature, role } = ctx || {};
    const p = cleanProps(props);
    if (!isName(name) || p === false || (feature !== undefined && !isName(feature)) || (role !== undefined && ROLES.indexOf(role) < 0))
      return warn(`event dropped: ${String(name)} (name, feature: snake_case <=64; role: ${ROLES.join('|')})`);
    core.emit(name, { props: p, feature, role });
  };
  const ac = startAutocapture(core, track);

  const commands: Record<string, (...a: any[]) => unknown> = {
    track,
    pageview: (path?: string) => ac.pageview(path),
    // use(props?) emits `<feature>_<role>`; use('event_name', props?) names the event explicitly.
    feature: (key: string) => {
      const h: Record<string, unknown> = {};
      for (const role of ROLES) h[role] = (a?: any, b?: any) => (typeof a == 'string' ? track(a, b, { feature: key, role } as any) : track(`${key}_${role}`, a, { feature: key, role } as any));
      return h;
    },
    identify(userId: string, traits?: Record<string, string>) {
      const t = cleanTraits(traits);
      if (!pa) return warn('identify() is for product_analytics');
      if (!isUserId(userId) || t === false) return warn('identify dropped: invalid userId');
      core.identify({ id: userId, traits: t });
    },
    reset: () => (pa ? core.reset() : warn('reset() is for product_analytics')),
    optOut: () => core.optOut(),
    optIn: () => core.optIn(),
    /** product_analytics: current session id. strict_anonymous: null (the server assigns the session). */
    sessionId: () => core.sessionId(),
    flush: () => core.tx.flush(),
  };

  const api: any = (cmd: string, ...a: unknown[]) => {
    try {
      return commands.hasOwnProperty(cmd) ? commands[cmd](...a) : warn('unknown command ' + String(cmd));
    } catch (e) {
      warn(`${cmd} failed: ${e}`);
      return null;
    }
  };
  for (const k in commands) api[k] = (...a: unknown[]) => api(k, ...a);
  api.version = VERSION;
  return { api: api as Union, core };
}
