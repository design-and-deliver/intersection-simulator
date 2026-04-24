import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config';
import { World } from '../src/sim/intersection';
import { isMovementSetSafe } from '../src/sim/conflicts';
import { ALL_MOVEMENTS } from '../src/sim/types';

describe('World end-to-end', () => {
  it('runs for several minutes without ever showing conflicting greens', () => {
    const w = new World({ seed: 123 });
    const dt = 100;
    const totalMs = 5 * 60_000;
    let lastViolation: string | null = null;
    for (let t = 0; t < totalMs; t += dt) {
      w.tick(dt);
      const r = isMovementSetSafe(w.controller.snapshot().greenMovements());
      if (!r.ok) {
        lastViolation = `${r.conflict[0]} + ${r.conflict[1]} at t=${t}`;
        break;
      }
    }
    expect(lastViolation).toBeNull();
  });

  it('serves cars when phases align with their lane', () => {
    // Heavy NS-STRAIGHT arrivals; assert NS-STRAIGHT served > 0 within 30s.
    const rates = Object.fromEntries(ALL_MOVEMENTS.map((m) => [m, 0]));
    rates['N-STRAIGHT'] = 240; // 4/sec
    const w = new World({ seed: 1, arrivalRates: rates });
    const dt = 100;
    for (let t = 0; t < 30_000; t += dt) w.tick(dt);
    const stats = w.lanes.stats('N-STRAIGHT');
    expect(stats.totalArrived).toBeGreaterThan(0);
    expect(stats.totalServed).toBeGreaterThan(0);
  });

  it('snapshot exposes time, controller, and queue lengths', () => {
    const w = new World({ seed: 2 });
    w.tick(1000);
    const s = w.snapshot();
    expect(s.timeMs).toBe(1000);
    expect(s.controller.phase).toBeDefined();
    expect(Object.keys(s.queues).length).toBe(ALL_MOVEMENTS.length);
  });

  it('is reproducible given the same seed', () => {
    const run = () => {
      const w = new World({ seed: 99 });
      for (let t = 0; t < 60_000; t += 100) w.tick(100);
      return w.lanes.stats('N-STRAIGHT').totalArrived;
    };
    expect(run()).toBe(run());
  });

  it('uses fixed-timer phase progression in step 3', () => {
    const w = new World({ seed: 1 });
    const cycleMs = CONFIG.fixedGreenMs + CONFIG.yellowMs + CONFIG.allRedMs;
    w.tick(cycleMs);
    expect(w.controller.state.phaseIndex).toBe(1);
  });
});
