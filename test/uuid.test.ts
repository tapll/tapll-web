import { describe, expect, it, vi } from 'vitest';
import { UUID_RE, uuid } from '../src/uuid';

describe('uuid', () => {
  it('v4 has version 4 and the RFC variant', () => {
    for (let i = 0; i < 50; i++) {
      const u = uuid(4);
      expect(u).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(UUID_RE.test(u)).toBe(true);
    }
  });
  it('v7 carries the millisecond timestamp and sorts by time', () => {
    const a = uuid(7, 1_700_000_000_000);
    const b = uuid(7, 1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(parseInt(a.replace(/-/g, '').slice(0, 12), 16)).toBe(1_700_000_000_000);
    expect(a < b).toBe(true);
  });
  it('v7 defaults to now', () => {
    vi.useFakeTimers({ now: 1_800_000_000_000 });
    expect(parseInt(uuid(7).replace(/-/g, '').slice(0, 12), 16)).toBe(1_800_000_000_000);
    vi.useRealTimers();
  });
  it('is unique', () => {
    expect(new Set(Array.from({ length: 500 }, () => uuid(7))).size).toBe(500);
  });
});
