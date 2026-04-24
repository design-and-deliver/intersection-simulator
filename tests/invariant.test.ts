import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config';
import { World } from '../src/sim/intersection';
import { isMovementSetSafe } from '../src/sim/conflicts';
import { ALL_MOVEMENTS, type Movement } from '../src/sim/types';
import { mulberry32 } from '../src/sim/rng';

/**
 * Global safety invariant: at every simulation tick, the set of movements
 * showing GREEN must be pairwise compatible (no crossing-path conflicts).
 *
 * The plan calls this the "gate" test — every feature added after this point
 * (actuation, pedestrian phase, flashing orange) mutates controller state in
 * non-trivial ways. This test runs each scenario long enough that any
 * unsafe state would surface with high probability, then locks the safety
 * guarantee in place so regressions break the build.
 */

const SCENARIOS: { label: string; rates: Partial<Record<Movement, number>>; seed: number }[] = [
  { label: 'balanced light traffic',     rates: rateFor(8, 8),    seed: 1 },
  { label: 'heavy NS-through, light EW', rates: rateFor(40, 4),   seed: 2 },
  { label: 'heavy left turns everywhere', rates: leftHeavy(20),   seed: 3 },
  { label: 'sparse arrivals (skip-able)', rates: rateFor(2, 2),   seed: 4 },
  { label: 'asymmetric: only N has demand', rates: onlyOneApproach('N', 30), seed: 5 },
];

const SIM_MINUTES = 10;
const DT_MS = 100;
const TOTAL_MS = SIM_MINUTES * 60_000;

describe('Global safety invariant', () => {
  it.each(SCENARIOS)('no conflicting greens over $label', ({ rates, seed }) => {
    const w = new World({ seed, arrivalRates: rates });
    let firstViolation: { tMs: number; conflict: [Movement, Movement] } | null = null;

    for (let t = 0; t < TOTAL_MS && !firstViolation; t += DT_MS) {
      w.tick(DT_MS);
      const greens = w.controller.snapshot().greenMovements();
      const r = isMovementSetSafe(greens);
      if (!r.ok) firstViolation = { tMs: t, conflict: r.conflict };
    }

    if (firstViolation) {
      const { tMs, conflict } = firstViolation;
      throw new Error(
        `Safety invariant violated at sim t=${tMs}ms: ` +
        `${conflict[0]} and ${conflict[1]} simultaneously green`,
      );
    }
    expect(firstViolation).toBeNull();
  });

  it('all-red clearance: every green→red transition passes through yellow', () => {
    // Track each movement's signal state across ticks; assert that any GREEN→RED
    // is preceded by at least one YELLOW frame.
    const w = new World({ seed: 99 });
    const lastColor = new Map<Movement, 'GREEN' | 'YELLOW' | 'RED'>();
    for (const m of ALL_MOVEMENTS) lastColor.set(m, 'RED');

    const offenders: { mv: Movement; tMs: number; from: string; to: string }[] = [];
    for (let t = 0; t < 3 * 60_000; t += DT_MS) {
      w.tick(DT_MS);
      const snap = w.controller.snapshot();
      for (const m of ALL_MOVEMENTS) {
        const cur = snap.signalFor(m);
        const prev = lastColor.get(m)!;
        if (prev === 'GREEN' && cur === 'RED') {
          offenders.push({ mv: m, tMs: t, from: prev, to: cur });
        }
        lastColor.set(m, cur);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('simulation is deterministic given the same seed (and varies with seed)', () => {
    // Seed only affects RNG-driven arrivals, not the fixed-timer phase ring,
    // so we sample arrival counts to detect both reproducibility *and* seed sensitivity.
    const sample = (seed: number) => {
      const w = new World({ seed, arrivalRates: rateFor(20, 20) });
      for (let t = 0; t < 30_000; t += 250) w.tick(250);
      return ALL_MOVEMENTS.map((m) => w.lanes.stats(m).totalArrived).join(',');
    };
    expect(sample(7)).toBe(sample(7));
    expect(sample(7)).not.toBe(sample(8));
  });
});

// ── helpers ────────────────────────────────────────────────────────────────

function rateFor(nsPerMin: number, ewPerMin: number): Partial<Record<Movement, number>> {
  const r: Partial<Record<Movement, number>> = {};
  for (const m of ALL_MOVEMENTS) {
    const ns = m.startsWith('N-') || m.startsWith('S-');
    r[m] = ns ? nsPerMin : ewPerMin;
  }
  return r;
}

function leftHeavy(perMin: number): Partial<Record<Movement, number>> {
  const r: Partial<Record<Movement, number>> = {};
  for (const m of ALL_MOVEMENTS) {
    r[m] = m.endsWith('-LEFT') ? perMin : Math.floor(perMin / 4);
  }
  return r;
}

function onlyOneApproach(approach: 'N' | 'S' | 'E' | 'W', perMin: number): Partial<Record<Movement, number>> {
  const r: Partial<Record<Movement, number>> = {};
  for (const m of ALL_MOVEMENTS) {
    r[m] = m.startsWith(`${approach}-`) ? perMin : 0;
  }
  return r;
}
