import type { Config } from './types';
import { warn } from './validation';

export const DEFAULT_API = 'https://in.useunion.dev';

/** `*` matches any run of characters (slashes included); everything else is literal. */
export const globToRegExp = (g: string): RegExp => new RegExp('^' + g.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');

/** Reads the `<script data-*>` attributes. Returns null (with a warning) if the key is missing. */
export function readConfig(el: Element | null, hostname: string): Config | null {
  const a = (n: string): string => ((el && el.getAttribute('data-' + n)) || '').trim();
  const key = a('key');
  const env = a('env');
  let version = a('version');
  if (!key) return warn('data-key missing'), null;
  if (version.length > 32) (warn('data-version >32 chars'), (version = ''));
  return {
    key,
    mode: a('mode') === 'product_analytics' ? 'product_analytics' : 'strict_anonymous',
    version: version || undefined,
    url: (a('api') || DEFAULT_API).replace(/\/+$/, '') + '/v1/web',
    exclude: a('exclude').split(',').map((s) => s.trim()).filter(Boolean).map(globToRegExp),
    // development: forced, or localhost / 127.* / *.local
    env: env === 'development' || env === 'production' ? env : /^(localhost$|127\.)|\.local$/i.test(hostname) ? 'development' : 'production',
    auto: a('auto') !== 'false',
    spa: a('spa') !== 'false',
    consent: a('consent') === 'banner' ? 'banner' : a('consent') === 'required' ? 'required' : 'none',
    base: ((el && (el as HTMLScriptElement).src) || '').replace(/[^/]*$/, ''),
  };
}
