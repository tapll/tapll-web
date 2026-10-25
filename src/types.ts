export type PropertyValue = string | number | boolean;
export type Properties = Record<string, PropertyValue>;
export type Role = 'discovery' | 'start' | 'use' | 'success' | 'failure';
export type Mode = 'strict_anonymous' | 'product_analytics';
export type Env = 'development' | 'production';

export interface PageContext {
  hostname: string;
  referrer?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_term?: string;
  utm_content?: string;
}

/** `WebEvent` of the wire contract. */
export interface WebEvent {
  event_id: string;
  session_id?: string;
  name: string;
  timestamp: number;
  screen?: string;
  properties?: Properties;
  feature?: string;
  role?: Role;
  page?: PageContext;
}

export interface Config {
  key: string;
  mode: Mode;
  version?: string;
  /** Full URL events are POSTed to (`${data-api}/v1/web`). */
  url: string;
  exclude: RegExp[];
  env: Env;
  auto: boolean;
  spa: boolean;
  /**
   * `none`: collect from load. `required`: hold everything in memory until `union.consent(true)` (the
   * site's own consent tool calls it). `banner`: the same, and show Union's own banner (`consent.js`).
   */
  consent: 'none' | 'required' | 'banner';
  /** Where `consent.js` lives: next to `u.js`. */
  base: string;
}

export interface EmitOptions {
  screen?: string;
  props?: Properties;
  feature?: string;
  role?: Role;
  page?: PageContext;
}
