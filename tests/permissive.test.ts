import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/intersection';
import { ALL_MOVEMENTS, type Movement } from '../src/sim/types';

/**
 * Permissive-left (FLASHING_ORANGE) service tests.
 *
 * Property under test: a LEFT car is released via permissive (during the
 * opposite-through phase, while showing flashing orange) ONLY when the
 * opposing through is clear — empty queue AND no opposing cars in flight.
 *
 * The strict safety invariant is unaffected because flashing-orange isn't
 * a green, so the LEFT movement is never in `greenMovements()`.
 */

const noArrivals: Partial<Record<Movement, number>> = Object.fromEntries(
  ALL_MOVEMENTS.map((m) => [m, 0]),
);

const opposingThroughOf: Record<string, Movement> = {
  'N-LEFT': 'S-STRAIGHT',
  'S-LEFT': 'N-STRAIGHT',
  'E-LEFT': 'W-STRAIGHT',
  'W-LEFT': 'E-STRAIGHT',
};

describe('Permissive-left service (property: only releases when opposing is clear)', () => {
  it('every permissive N-LEFT release happens with S-STRAIGHT empty AND nothing in flight', () => {
    // Engineered scenario: N-STRAIGHT keeps Phase A actively running; S-STRAIGHT
    // is empty (so opposing is always clear); N-LEFT has demand to permissive-turn.
    // This guarantees the permissive code path actually fires so the property check is real.
    const w = new World({
      seed: 42,
      arrivalRates: { ...noArrivals, 'N-STRAIGHT': 30, 'N-LEFT': 30 },
    });

    let permissiveReleases = 0;
    let violations = 0;
    for (let t = 0; t < 60_000; t += 100) {
      const sigBefore = w.controller.snapshot().leftSignalFor('N-LEFT');
      const oppQ = w.lanes.queue('S-STRAIGHT').length;
      const oppInFlight = w.lanes.inFlight.filter((c) => c.lane === 'S-STRAIGHT').length;
      const oppClearBefore = oppQ === 0 && oppInFlight === 0;

      const result = w.tick(100);

      const releasedNLeft = result.released.some((c) => c.lane === 'N-LEFT');
      if (releasedNLeft && sigBefore === 'FLASHING_ORANGE') {
        permissiveReleases += 1;
        if (!oppClearBefore) violations += 1;
      }
    }

    expect(violations).toBe(0);
    // Scenario is engineered to fire permissive — confirms the wiring works at all.
    expect(permissiveReleases).toBeGreaterThan(0);
  });

  it('property holds for all four LEFT movements simultaneously', () => {
    const w = new World({
      seed: 7,
      arrivalRates: {
        ...noArrivals,
        'N-STRAIGHT': 20, 'S-STRAIGHT': 20, 'E-STRAIGHT': 20, 'W-STRAIGHT': 20,
        'N-LEFT': 30, 'S-LEFT': 30, 'E-LEFT': 30, 'W-LEFT': 30,
      },
    });

    const violations: string[] = [];
    for (let t = 0; t < 90_000; t += 100) {
      const stateBefore: Record<string, { sig: string; clear: boolean }> = {};
      for (const left of Object.keys(opposingThroughOf)) {
        const opp = opposingThroughOf[left]!;
        stateBefore[left] = {
          sig: w.controller.snapshot().leftSignalFor(left as Movement),
          clear: w.lanes.queue(opp).length === 0 && !w.lanes.inFlight.some((c) => c.lane === opp),
        };
      }
      const result = w.tick(100);
      for (const left of Object.keys(opposingThroughOf)) {
        const wasReleased = result.released.some((c) => c.lane === left);
        if (wasReleased && stateBefore[left]!.sig === 'FLASHING_ORANGE' && !stateBefore[left]!.clear) {
          violations.push(`${left} permissive-released at t=${t}ms with opposing busy`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('strict safety invariant: greenMovements() never contains a LEFT during opposite-through phase', () => {
    // Permissive cars are released but NOT promoted to green. Verify across
    // a busy permissive-eligible scenario.
    const w = new World({
      seed: 99,
      arrivalRates: { ...noArrivals, 'N-LEFT': 60, 'S-LEFT': 60, 'E-LEFT': 60, 'W-LEFT': 60 },
    });
    for (let t = 0; t < 30_000; t += 100) {
      w.tick(100);
      const greens = w.controller.snapshot().greenMovements();
      const phaseId = w.controller.snapshot().phase.id;
      // Phase A movements are NS through+rights, never include N/S LEFT.
      // Phase C movements are EW through+rights, never include E/W LEFT.
      if (phaseId === 'A') {
        expect(greens.has('N-LEFT')).toBe(false);
        expect(greens.has('S-LEFT')).toBe(false);
      } else if (phaseId === 'C') {
        expect(greens.has('E-LEFT')).toBe(false);
        expect(greens.has('W-LEFT')).toBe(false);
      }
    }
  });

  it('Poisson lookahead blocks permissive when opposing arrival rate is high (even with empty snapshot)', () => {
    // Opposing rate is high enough that mid-turn opposing arrival is likely.
    // For S-STRAIGHT at 60/min (mean inter-arrival 1s), P(arrival in 3.8s LEFT
    // transit) ≈ 1 - e^(-3.8) ≈ 0.978 — well above the 20% lookahead threshold.
    // Even when the snapshot momentarily shows opposing clear, lookahead refuses.
    //
    // To isolate the lookahead from the snapshot: keep S-STRAIGHT rate high but
    // S-STRAIGHT arrivals seeded such that there's at least one early gap.
    const w = new World({
      seed: 1,
      arrivalRates: { ...noArrivals, 'N-STRAIGHT': 30, 'N-LEFT': 60, 'S-STRAIGHT': 60 },
    });

    let snapshotClearMoments = 0;
    let permissiveReleasesDespiteHighRate = 0;
    for (let t = 0; t < 60_000; t += 100) {
      const sigBefore = w.controller.snapshot().leftSignalFor('N-LEFT');
      const oppQ = w.lanes.queue('S-STRAIGHT').length;
      const oppInFlight = w.lanes.inFlight.filter((c) => c.lane === 'S-STRAIGHT').length;
      const snapshotClear = oppQ === 0 && oppInFlight === 0;
      if (snapshotClear && sigBefore === 'FLASHING_ORANGE') snapshotClearMoments += 1;
      const result = w.tick(100);
      if (result.released.some((c) => c.lane === 'N-LEFT') && sigBefore === 'FLASHING_ORANGE') {
        permissiveReleasesDespiteHighRate += 1;
      }
    }

    // With a 60/min opposing rate, lookahead should block ALL permissive releases
    // even though the snapshot occasionally shows clear.
    expect(snapshotClearMoments).toBeGreaterThan(0); // snapshot WAS clear at times
    expect(permissiveReleasesDespiteHighRate).toBe(0); // but lookahead prevented all releases
  });

  it('no permissive release for protected-LEFT phase (LEFT shows GREEN, not flashing)', () => {
    // During Phase B, N-LEFT is GREEN (protected). The release should happen,
    // but it's via the normal green path, not permissive — so opposing-clear
    // is irrelevant to the release decision (S-STRAIGHT is RED in Phase B).
    const w = new World({
      seed: 11,
      arrivalRates: { ...noArrivals, 'N-LEFT': 60, 'S-STRAIGHT': 60 },
    });
    let releasedDuringProtected = 0;
    for (let t = 0; t < 60_000; t += 100) {
      const phaseId = w.controller.snapshot().phase.id;
      const sig = w.controller.snapshot().leftSignalFor('N-LEFT');
      const result = w.tick(100);
      if (phaseId === 'B' && sig === 'GREEN' && result.released.some((c) => c.lane === 'N-LEFT')) {
        releasedDuringProtected += 1;
      }
    }
    // Must serve some N-LEFT cars via the protected phase.
    expect(releasedDuringProtected).toBeGreaterThan(0);
  });
});
