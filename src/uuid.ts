/** UUIDs without a dependency: v7 (time-ordered) for event/session ids, v4 for batch/install ids. */
const rnd = (n: number): string => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => (b + 256).toString(16).slice(1)).join('');

export function uuid(version: 4 | 7, ms: number = Date.now()): string {
  // 32 hex digits: v7 starts with the 48-bit millisecond timestamp, v4 is all random.
  const h = (version == 7 ? ms.toString(16).padStart(12, '0') + rnd(10) : rnd(16)).split('');
  h[12] = String(version);
  h[16] = '89ab'[parseInt(h[16], 16) & 3];
  return h.join('').replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
