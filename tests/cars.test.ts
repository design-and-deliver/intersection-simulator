import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config';
import { Lanes } from '../src/sim/cars';
import { mulberry32 } from '../src/sim/rng';
import { ALL_MOVEMENTS, type Movement } from '../src/sim/types';

const noGreen = new Set<Movement>();

describe('Lane arrivals (Poisson)', () => {
  it('produces zero arrivals when rate is zero', () => {
    const rng = mulberry32(1);
    const lanes = new Lanes(CONFIG, rng, Object.fromEntries(ALL_MOVEMENTS.map((m) => [m, 0])));
    lanes.tick(60_000, 60_000, noGreen);
    for (const m of ALL_MOVEMENTS) {
      expect(lanes.stats(m).totalArrived).toBe(0);
    }
  });

  it('produces approximately the configured arrivals over a long window', () => {
    const rng = mulberry32(42);
    const ratePerMin = 60; // 1 per second
    const lanes = new Lanes(CONFIG, rng, { 'N-STRAIGHT': ratePerMin });
    // Tick many small steps over 10 minutes.
    const totalMs = 10 * 60_000;
    const dt = 100;
    for (let t = 0; t < totalMs; t += dt) lanes.tick(dt, t + dt, noGreen);
    const got = lanes.stats('N-STRAIGHT').totalArrived;
    // Expected ~600 over 10 min. Allow ±25% slack for randomness with this seed.
    expect(got).toBeGreaterThan(450);
    expect(got).toBeLessThan(750);
  });

  it('is reproducible given the same seed', () => {
    const run = () => {
      const lanes = new Lanes(CONFIG, mulberry32(7), { 'N-STRAIGHT': 30 });
      for (let t = 0; t < 60_000; t += 100) lanes.tick(100, t + 100, noGreen);
      return lanes.stats('N-STRAIGHT').totalArrived;
    };
    expect(run()).toBe(run());
  });
});

describe('Lane service', () => {
  it('does not serve when red', () => {
    const lanes = new Lanes(CONFIG, mulberry32(1), { 'N-STRAIGHT': 600 });
    for (let t = 0; t < 5000; t += 100) lanes.tick(100, t + 100, noGreen);
    expect(lanes.stats('N-STRAIGHT').totalServed).toBe(0);
    expect(lanes.stats('N-STRAIGHT').queueLength).toBeGreaterThan(0);
  });

  it('serves the front car once its slide-in animation completes (and light is green)', () => {
    // Cars wait APPROACH_MS for the slide-in to finish before being released —
    // otherwise they'd teleport from mid-slide into the intersection bezier.
    const burst = new Lanes(CONFIG, mulberry32(1), { 'N-STRAIGHT': 6000 });
    // Burst arrivals over 2s so the first arrivals are well past APPROACH_MS.
    burst.tick(2000, 2000, noGreen);
    expect(burst.stats('N-STRAIGHT').queueLength).toBeGreaterThan(0);
    const green = new Set<Movement>(['N-STRAIGHT']);
    const out = burst.tick(1, 2001, green);
    expect(out.length).toBeGreaterThanOrEqual(1);
  });

  it('respects service headway between successive cars (parallel service across sub-lanes)', () => {
    const lanes = new Lanes(CONFIG, mulberry32(1), { 'N-STRAIGHT': 6000 });
    lanes.tick(2000, 2000, noGreen); // build queue
    const queueBefore = lanes.stats('N-STRAIGHT').queueLength;
    expect(queueBefore).toBeGreaterThanOrEqual(5);
    const green = new Set<Movement>(['N-STRAIGHT']);
    // Run for exactly headway*N. STRAIGHT has 2 sub-lanes serving in parallel,
    // so each sub-lane releases ~N+1 cars (first immediate + N at headway intervals).
    const N = 3;
    const dur = CONFIG.serviceHeadwayMs * N;
    let totalReleased = 0;
    const dt = 50;
    for (let t = 0; t < dur; t += dt) {
      totalReleased += lanes.tick(dt, 2000 + t + dt, green).length;
    }
    // 2 sub-lanes × ~(N+1) per sub-lane, with some slack for dt overshoot.
    expect(totalReleased).toBeGreaterThanOrEqual(2 * N);
    expect(totalReleased).toBeLessThanOrEqual(2 * (N + 1));
  });

  it('records wait time for served cars', () => {
    const lanes = new Lanes(CONFIG, mulberry32(1), { 'N-STRAIGHT': 6000 });
    lanes.tick(3000, 3000, noGreen);
    const green = new Set<Movement>(['N-STRAIGHT']);
    for (let t = 0; t < 10_000; t += 100) lanes.tick(100, 3000 + t + 100, green);
    const stats = lanes.stats('N-STRAIGHT');
    expect(stats.totalServed).toBeGreaterThan(0);
    expect(stats.totalWaitMs).toBeGreaterThan(0);
    const avgWait = stats.totalWaitMs / stats.totalServed;
    expect(avgWait).toBeGreaterThan(0);
    expect(avgWait).toBeLessThan(10_000);
  });
});

describe('Lane sensor', () => {
  it('reports demand when a car is queued', () => {
    const lanes = new Lanes(CONFIG, mulberry32(1), { 'N-STRAIGHT': 6000 });
    lanes.tick(2000, 2000, noGreen);
    expect(lanes.hasDemand('N-STRAIGHT')).toBe(true);
  });

  it('reports no demand when the lane is empty', () => {
    const lanes = new Lanes(CONFIG, mulberry32(1), { 'N-STRAIGHT': 0 });
    expect(lanes.hasDemand('N-STRAIGHT')).toBe(false);
  });
});
