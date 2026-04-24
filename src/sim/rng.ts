/**
 * Tiny seedable PRNG (mulberry32). Deterministic given the same seed —
 * required so simulation tests are reproducible.
 */
export interface Rng {
  next(): number; // [0, 1)
}

export function mulberry32(seed: number): Rng {
  let s = seed >>> 0;
  return {
    next(): number {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Sample an exponential inter-arrival time in ms for a rate of `perMinute` events per minute. */
export function exponentialMs(rng: Rng, perMinute: number): number {
  if (perMinute <= 0) return Number.POSITIVE_INFINITY;
  const u = Math.max(rng.next(), Number.EPSILON);
  const meanMs = 60_000 / perMinute;
  return -Math.log(u) * meanMs;
}
