import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BUDGET } from '../scripts/budget.mjs';
import { assertBatch, setupEnv, teardownEnv } from './helpers';

const root = new URL('../', import.meta.url).pathname;

beforeAll(() => {
  execFileSync('node', ['scripts/build.mjs'], { cwd: root, stdio: 'pipe' });
});

describe('build output', () => {
  it(`dist/u.js is within the gzip budget (${BUDGET} bytes)`, () => {
    const size = gzipSync(readFileSync(root + 'dist/u.js'), { level: 9 }).length;
    console.log(`dist/u.js: ${size} B gzip`);
    expect(size).toBeLessThanOrEqual(BUDGET);
  });

  it('ships a source map and typings; the IIFE targets es2017 (no spread/optional chaining)', () => {
    expect(existsSync(root + 'dist/u.js.map')).toBe(true);
    expect(readFileSync(root + 'dist/u.d.ts', 'utf8')).toContain('interface Tapll');
    const js = readFileSync(root + 'dist/u.js', 'utf8');
    expect(js.startsWith('"use strict";(()=>{') || js.startsWith('"use strict";')).toBe(true);
    expect(js).not.toMatch(/\?\.|\?\?/);
    expect(js).toContain('sourceMappingURL=u.js.map');
    expect(js).not.toMatch(/\bimport\(|\brequire\(/);
  });
});

describe('the built script works as shipped', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(teardownEnv);

  it('boots from <script data-key>, replays tapll.q, pageviews, and sends a valid batch', async () => {
    const env = setupEnv('https://example.com/landing?utm_source=n');
    const w = env.win as any;
    w.tapll = function () {
      (w.tapll.q = w.tapll.q || []).push(arguments);
    };
    w.tapll('track', 'queued_before_load', { a: 1 });
    w.document.head.innerHTML = '<script data-key="av_dist" data-mode="strict_anonymous" data-version="7"></script>';
    (0, eval)(readFileSync(root + 'dist/u.js', 'utf8'));
    expect(w.tapll.version).toBe('0.5.0');
    expect(w.union).toBe(w.tapll);
    w.tapll.track('after_load');
    await w.tapll.flush();
    expect(env.fetched).toHaveLength(1);
    assertBatch(env.fetched[0]);
    expect(env.fetched[0]).toMatchObject({ key: 'av_dist', privacy_mode: 'strict_anonymous', device: { app_version: '7', sdk_version: '0.5.0' } });
    expect(env.fetched[0].events.map((e: any) => e.name)).toEqual(['$pageview', 'queued_before_load', 'after_load']);
    expect(env.fetched[0].events[0].page.utm_source).toBe('n');
    // loading the same file again is harmless
    const first = w.tapll;
    (0, eval)(readFileSync(root + 'dist/u.js', 'utf8'));
    expect(w.tapll).toBe(first);
  });
});
