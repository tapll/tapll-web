import { describe, expect, it } from 'vitest';
import { backoff, decide } from '../src/policy';

const d400 = (...paths: string[]) => ({ status: 400, body: { error: 'invalid_batch', message: 'x', details: paths.map((path) => ({ path, message: 'm' })) } });

describe('decide (response policy)', () => {
  it('202 ok', () => expect(decide({ status: 202 })).toEqual({ t: 'ok' }));
  it('400 naming events drops exactly those', () => {
    expect(decide(d400('events.1.properties.a', 'events.3.name', 'events.1.screen'))).toEqual({ t: 'drop', idx: [1, 3, 1] });
  });
  it('400 with an envelope problem drops the whole batch', () => {
    expect(decide(d400('events.0.name', 'identity'))).toEqual({ t: 'batch' });
    expect(decide(d400('environment'))).toEqual({ t: 'batch' });
  });
  it('400 without details or with a privacy violation drops the batch', () => {
    expect(decide({ status: 400 })).toEqual({ t: 'batch' });
    expect(decide({ status: 400, body: { error: 'invalid_batch', message: 'x' } })).toEqual({ t: 'batch' });
    expect(decide({ status: 400, body: { error: 'privacy_violation', message: 'x', details: [{ path: 'events.0.x' }] } })).toEqual({ t: 'batch' });
  });
  it('401 and 403 stop', () => {
    expect(decide({ status: 401 })).toEqual({ t: 'stop' });
    expect(decide({ status: 403, body: { error: 'origin_not_allowed' } })).toEqual({ t: 'stop' });
  });
  it('413 splits', () => expect(decide({ status: 413 })).toEqual({ t: 'split' }));
  it('429 waits Retry-After seconds, else 300s', () => {
    expect(decide({ status: 429, retryAfter: '7' })).toEqual({ t: 'pause', ms: 7000 });
    expect(decide({ status: 429, retryAfter: null })).toEqual({ t: 'pause', ms: 300000 });
    expect(decide({ status: 429, retryAfter: 'soon' })).toEqual({ t: 'pause', ms: 300000 });
    expect(decide({ status: 429, retryAfter: '0' })).toEqual({ t: 'pause', ms: 300000 });
  });
  it('5xx, network error (0) and anything unexpected retry', () => {
    for (const status of [500, 502, 503, 0, 404, 418]) expect(decide({ status }), String(status)).toEqual({ t: 'retry' });
  });
});

describe('backoff', () => {
  it('doubles from 2s to a 5 minute cap with jitter 0.5-1.0', () => {
    expect(backoff(0, () => 1)).toBe(2000);
    expect(backoff(1, () => 1)).toBe(4000);
    expect(backoff(2, () => 1)).toBe(8000);
    expect(backoff(0, () => 0)).toBe(1000);
    expect(backoff(20, () => 1)).toBe(300000);
    expect(backoff(20, () => 0)).toBe(150000);
  });
});
