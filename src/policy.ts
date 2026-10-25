/** Server response policy (mirrors `ServerResponse.swift`; 401 and 403 both stop the SDK for the page load). */
export type Disposition = { t: 'ok' | 'batch' | 'split' | 'stop' | 'retry' } | { t: 'drop'; idx: number[] } | { t: 'pause'; ms: number };

export interface Reply {
  status: number;
  body?: any;
  retryAfter?: string | null;
}

/** 2s, 4s, 8s ... capped at 5 minutes, full jitter in 0.5-1.0. */
export const backoff = (attempt: number, rnd: () => number = Math.random): number => Math.min(300, 2 * Math.pow(2, attempt)) * (0.5 + rnd() / 2) * 1000;

export function decide({ status: s, body, retryAfter }: Reply): Disposition {
  if (s === 202) return { t: 'ok' };
  if (s === 400) {
    const paths: string[] = ((body && body.details) || []).map((d: any) => String(d && d.path));
    const idx = paths.map((p) => /^events\.(\d+)/.exec(p)).filter(Boolean).map((m) => +m![1]);
    // An envelope problem (identity, environment, ...) or a privacy violation means the whole batch is wrong.
    return (body && body.error) === 'privacy_violation' || !idx.length || idx.length < paths.length ? { t: 'batch' } : { t: 'drop', idx };
  }
  return s === 401 || s === 403 ? { t: 'stop' } : s === 413 ? { t: 'split' } : s === 429 ? { t: 'pause', ms: (+retryAfter! > 0 ? Math.min(+retryAfter!, 3600) : 300) * 1000 } : { t: 'retry' };
}
