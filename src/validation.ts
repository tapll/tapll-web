import type { Properties } from './types';

/** Mirrors `packages/contract/src/limits.ts`. Invalid input is dropped, never truncated. */
export const ROLES = ['discovery', 'start', 'use', 'success', 'failure'];
export const PATH_MAX = 128;

export function warn(msg: string): void {
  try {
    console.warn('[tapll] ' + msg);
  } catch {
    /* never throw */
  }
}

/** Lowercase snake_case, starts with a letter, <= 64: event names and feature keys. */
export const isName = (n: unknown): n is string => typeof n === 'string' && n.length <= 64 && /^[a-z][a-z0-9_]*$/.test(n);

/**
 * Shared by properties (<=32, key <=64, string|finite number|boolean) and traits (<=8, key <=40, string).
 * `undefined` = nothing to send, `false` = invalid (the caller drops the event).
 */
function clean(o: any, what: string, max: number, keyMax: number, ok: (v: unknown) => boolean): Record<string, any> | undefined | false {
  if (o == null) return undefined;
  const keys = typeof o == 'object' ? Object.keys(o).filter((k) => o[k] !== undefined) : [];
  const bad = keys.find((k) => !k || k.length > keyMax || !ok(o[k]));
  if (typeof o != 'object' || Array.isArray(o) || bad !== undefined || keys.length > max) return warn(`${what} invalid${bad === undefined ? '' : ': ' + bad}`), false;
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = o[k];
  return keys.length ? out : undefined;
}

const str = (v: unknown): boolean => typeof v == 'string' && v.length <= 256;

export const cleanProps = (p: unknown) => clean(p, 'properties', 32, 64, (v) => typeof v == 'boolean' || (typeof v == 'number' && isFinite(v)) || str(v)) as Properties | undefined | false;

export const cleanTraits = (t: unknown) => clean(t, 'traits', 8, 40, str) as Record<string, string> | undefined | false;

export const isUserId = (u: unknown): u is string => typeof u == 'string' && u.length > 0 && u.length <= 128;

/** Strips query/fragment; returns undefined (with a warning) if it is not a usable path (starts with "/", <=128). */
export function cleanPath(p: unknown): string | undefined {
  const s = typeof p == 'string' ? p.split(/[?#]/)[0] : '';
  if (s[0] == '/' && s.length <= PATH_MAX) return s;
  warn('skipped path ' + s);
}
