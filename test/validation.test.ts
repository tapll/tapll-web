import { describe, expect, it, vi } from 'vitest';
import { cleanPath, cleanProps, cleanTraits, isName, isUserId } from '../src/validation';

const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => {});
const rep = (n: number, c = 'a') => c.repeat(n);

describe('event names and feature keys', () => {
  it('accepts lowercase snake_case up to 64 chars', () => {
    for (const n of ['a', 'checkout_started', 'a1_b2', rep(64)]) expect(isName(n), n).toBe(true);
  });
  it('rejects everything else', () => {
    for (const n of ['', 'Checkout', '1abc', '_x', 'has space', 'dash-ed', '$pageview', rep(65), 'ünï', 1, null, undefined, {}])
      expect(isName(n), String(n)).toBe(false);
  });
});

describe('properties', () => {
  it('passes string, finite number and boolean', () => {
    expect(cleanProps({ a: 'x', b: 1.5, c: false, d: 0 })).toEqual({ a: 'x', b: 1.5, c: false, d: 0 });
  });
  it('nothing to send for null, undefined, {} and undefined values', () => {
    expect(cleanProps(undefined)).toBeUndefined();
    expect(cleanProps(null)).toBeUndefined();
    expect(cleanProps({})).toBeUndefined();
    expect(cleanProps({ a: undefined })).toBeUndefined();
  });
  it('accepts the limits exactly: 32 props, key 64, string 256', () => {
    const p: Record<string, string> = {};
    for (let i = 0; i < 32; i++) p['k' + i] = rep(256);
    expect(cleanProps(p)).toEqual(p);
    expect(cleanProps({ [rep(64)]: 1 })).toEqual({ [rep(64)]: 1 });
  });
  it('is invalid (never truncated) past the limits', () => {
    quiet();
    const many: Record<string, number> = {};
    for (let i = 0; i < 33; i++) many['k' + i] = i;
    expect(cleanProps(many)).toBe(false);
    expect(cleanProps({ [rep(65)]: 1 })).toBe(false);
    expect(cleanProps({ a: rep(257) })).toBe(false);
    expect(cleanProps({ '': 1 })).toBe(false);
  });
  it('rejects non-finite numbers, objects, arrays, null values and non-objects', () => {
    quiet();
    for (const bad of [{ a: NaN }, { a: Infinity }, { a: {} }, { a: [] }, { a: null }, { a: () => 1 }, [1], 'str', 5, true])
      expect(cleanProps(bad), JSON.stringify(String(bad))).toBe(false);
  });
});

describe('traits and user id', () => {
  it('traits: <= 8, key <= 40, string values <= 256', () => {
    const t: Record<string, string> = {};
    for (let i = 0; i < 8; i++) t['t' + i] = rep(256);
    expect(cleanTraits(t)).toEqual(t);
    expect(cleanTraits({ [rep(40)]: 'x' })).toBeTruthy();
    expect(cleanTraits(undefined)).toBeUndefined();
  });
  it('traits invalid when too many, key too long, value not a string or too long', () => {
    quiet();
    const nine: Record<string, string> = {};
    for (let i = 0; i < 9; i++) nine['t' + i] = 'x';
    expect(cleanTraits(nine)).toBe(false);
    expect(cleanTraits({ [rep(41)]: 'x' })).toBe(false);
    expect(cleanTraits({ a: 1 })).toBe(false);
    expect(cleanTraits({ a: rep(257) })).toBe(false);
  });
  it('user id 1..128 chars', () => {
    expect(isUserId(rep(128))).toBe(true);
    expect(isUserId('u')).toBe(true);
    expect(isUserId('')).toBe(false);
    expect(isUserId(rep(129))).toBe(false);
    expect(isUserId(5)).toBe(false);
  });
});

describe('paths', () => {
  it('keeps a path, strips query and fragment', () => {
    expect(cleanPath('/a/b')).toBe('/a/b');
    expect(cleanPath('/a?x=1#y')).toBe('/a');
    expect(cleanPath('/#top')).toBe('/');
  });
  it('skips (undefined) a path that is relative or longer than 128', () => {
    quiet();
    expect(cleanPath('a/b')).toBeUndefined();
    expect(cleanPath('')).toBeUndefined();
    expect(cleanPath('/' + rep(128))).toBeUndefined();
    expect(cleanPath('/' + rep(127))).toHaveLength(128);
    expect(cleanPath(42)).toBeUndefined();
  });
});
