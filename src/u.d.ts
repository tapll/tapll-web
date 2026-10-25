/** Public typings for `window.union` (union-web). */
export type PropertyValue = string | number | boolean;
export type Properties = Record<string, PropertyValue>;
export type FeatureRole = 'discovery' | 'start' | 'use' | 'success' | 'failure';

export interface FeatureHandle {
  /** Event name: `<feature>_<role>`; pass a name first to override it: `use('exported_report', props)`. */
  discovery(props?: Properties): void;
  start(props?: Properties): void;
  use(props?: Properties): void;
  success(props?: Properties): void;
  failure(props?: Properties): void;
}

export interface Union {
  (command: string, ...args: unknown[]): unknown;
  readonly version: string;
  track(name: string, props?: Properties, context?: { feature?: string; role?: FeatureRole }): void;
  pageview(path?: string): void;
  feature(key: string): FeatureHandle;
  /** product_analytics only; no-op with a console warning in strict_anonymous. */
  identify(userId: string, traits?: Record<string, string>): void;
  reset(): void;
  optOut(): void;
  optIn(): void;
  /** product_analytics: current session id. strict_anonymous: the server-assigned session id from the latest 202 (memory only), null until then. */
  sessionId(): string | null;
  flush(): Promise<void>;
  /** The visitor's answer (`data-consent`): `true` releases what waited in memory, `false` is `optOut()`. Remembered. */
  consent(granted: boolean): void;
  consentStatus(): 'granted' | 'denied' | 'pending' | 'not_required';
  /** Re-opens Union's own banner (`data-consent="banner"`), e.g. from a "Privacy choices" footer link. */
  showConsent(): void;
}

declare global {
  interface Window {
    union?: Union;
  }
}
