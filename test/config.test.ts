import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { globToRegExp } from '../src/config';
import { config, script, setupEnv, teardownEnv } from './helpers';
import { readConfig } from '../src/config';

beforeEach(() => setupEnv('https://example.com/'));
afterEach(teardownEnv);

describe('readConfig', () => {
  it('defaults: strict, hosted endpoint, auto and spa on, production', () => {
    const c = config();
    expect(c).toMatchObject({ key: 'av_test', mode: 'strict_anonymous', url: 'https://in.tapll.com/v1/web', auto: true, spa: true, env: 'production', exclude: [] });
    expect(c.version).toBeUndefined();
  });
  it('requires data-key (warns, null)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readConfig(script({ key: '' }), 'example.com')).toBeNull();
    expect(readConfig(null, 'example.com')).toBeNull();
    expect(warn).toHaveBeenCalled();
  });
  it('mode: product_analytics, anything else is strict', () => {
    expect(config({ mode: 'product_analytics' }).mode).toBe('product_analytics');
    expect(config({ mode: 'weird' }).mode).toBe('strict_anonymous');
  });
  it('version: kept up to 32 chars, ignored (with a warning) above', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(config({ version: '1.2.3' }).version).toBe('1.2.3');
    expect(config({ version: 'v'.repeat(32) }).version).toHaveLength(32);
    expect(config({ version: 'v'.repeat(33) }).version).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
  it('api: absolute, trailing slash trimmed, relative first-party proxy', () => {
    expect(config({ api: 'https://t.example.com/' }).url).toBe('https://t.example.com/v1/web');
    expect(config({ api: '/_tapll' }).url).toBe('/_tapll/v1/web');
    expect(config({ api: '/_tapll///' }).url).toBe('/_tapll/v1/web');
  });
  it('auto and spa switch off only with "false"', () => {
    expect(config({ auto: 'false' }).auto).toBe(false);
    expect(config({ spa: 'false' }).spa).toBe(false);
    expect(config({ auto: 'no' }).auto).toBe(true);
  });
  it('environment: development for localhost, 127.*, *.local; data-env forces', () => {
    const env = (host: string, attrs = {}) => readConfig(script(attrs), host)!.env;
    for (const h of ['localhost', 'LOCALHOST', '127.0.0.1', '127.1.2.3', 'app.local', 'mac.local']) expect(env(h), h).toBe('development');
    for (const h of ['example.com', 'localhost.example.com', 'my127.0.0.1.com', 'local', 'notlocal.dev']) expect(env(h), h).toBe('production');
    expect(env('example.com', { env: 'development' })).toBe('development');
    expect(env('localhost', { env: 'production' })).toBe('production');
    expect(env('localhost', { env: 'staging' })).toBe('development');
  });
  it('exclude: comma separated globs', () => {
    const c = config({ exclude: ' /admin/* , /thanks ,, /a/*/b ' });
    const hit = (p: string) => c.exclude.some((r) => r.test(p));
    expect(hit('/admin/users/1')).toBe(true);
    expect(hit('/admin/')).toBe(true);
    expect(hit('/admin')).toBe(false);
    expect(hit('/thanks')).toBe(true);
    expect(hit('/thanks/x')).toBe(false);
    expect(hit('/a/x/b')).toBe(true);
    expect(hit('/a/x/c')).toBe(false);
    expect(hit('/')).toBe(false);
  });
});

describe('globToRegExp', () => {
  it('escapes regex metacharacters', () => {
    expect(globToRegExp('/a.b').test('/a.b')).toBe(true);
    expect(globToRegExp('/a.b').test('/aXb')).toBe(false);
    expect(globToRegExp('/(x)+').test('/(x)+')).toBe(true);
    expect(globToRegExp('*').test('/anything/at/all')).toBe(true);
  });
});
