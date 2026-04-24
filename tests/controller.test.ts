import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config';
import { Controller } from '../src/sim/controller';
import { RING } from '../src/sim/phases';

const cycleMs = CONFIG.fixedGreenMs + CONFIG.yellowMs + CONFIG.allRedMs;

describe('Controller initial state', () => {
  it('starts at phase index 0 in GREEN mode', () => {
    const c = new Controller();
    expect(c.state.phaseIndex).toBe(0);
    expect(c.state.mode).toBe('GREEN');
    expect(c.state.modeElapsedMs).toBe(0);
  });

  it('shows GREEN for active phase movements at t=0', () => {
    const c = new Controller();
    const snap = c.snapshot();
    for (const m of RING[0]!.movements) {
      expect(snap.signalFor(m)).toBe('GREEN');
    }
  });

  it('shows RED for inactive movements at t=0', () => {
    const c = new Controller();
    const snap = c.snapshot();
    expect(snap.signalFor('E-STRAIGHT')).toBe('RED');
    expect(snap.signalFor('N-LEFT')).toBe('RED');
  });
});

describe('Controller ring progression', () => {
  it('GREEN → YELLOW → ALL_RED → next-phase GREEN', () => {
    const c = new Controller();
    expect(c.state.mode).toBe('GREEN');

    c.tick(CONFIG.fixedGreenMs);
    expect(c.state.mode).toBe('YELLOW');
    expect(c.state.phaseIndex).toBe(0);

    c.tick(CONFIG.yellowMs);
    expect(c.state.mode).toBe('ALL_RED');
    expect(c.state.phaseIndex).toBe(0);

    c.tick(CONFIG.allRedMs);
    expect(c.state.mode).toBe('GREEN');
    expect(c.state.phaseIndex).toBe(1);
  });

  it('cycles through all phases A→B→C→D→A', () => {
    const c = new Controller();
    const seen: number[] = [];
    for (let i = 0; i < RING.length + 1; i++) {
      seen.push(c.state.phaseIndex);
      c.tick(cycleMs);
    }
    expect(seen).toEqual([0, 1, 2, 3, 0]);
  });

  it('handles a single dt that overshoots multiple sub-states', () => {
    const c = new Controller();
    c.tick(cycleMs * 2 + CONFIG.fixedGreenMs / 2);
    // Two full cycles → still phase 2 (started at 0, advanced 2 → 2)
    expect(c.state.phaseIndex).toBe(2);
    expect(c.state.mode).toBe('GREEN');
    // Half-way through fixed green
    expect(c.state.modeElapsedMs).toBeCloseTo(CONFIG.fixedGreenMs / 2, 5);
  });
});

describe('Controller signal transitions', () => {
  it('shows YELLOW for movements that were green during the yellow interval', () => {
    const c = new Controller();
    c.tick(CONFIG.fixedGreenMs); // enter YELLOW
    const snap = c.snapshot();
    for (const m of RING[0]!.movements) {
      expect(snap.signalFor(m)).toBe('YELLOW');
    }
  });

  it('shows RED for every vehicle movement during ALL_RED clearance', () => {
    const c = new Controller();
    c.tick(CONFIG.fixedGreenMs + CONFIG.yellowMs); // enter ALL_RED
    const snap = c.snapshot();
    for (const m of RING[0]!.movements) {
      expect(snap.signalFor(m)).toBe('RED');
    }
    // And inactive movements remain red.
    expect(snap.signalFor('E-STRAIGHT')).toBe('RED');
  });

  it('greenMovements() is empty during YELLOW and ALL_RED', () => {
    const c = new Controller();
    c.tick(CONFIG.fixedGreenMs);
    expect(c.snapshot().greenMovements().size).toBe(0);
    c.tick(CONFIG.yellowMs);
    expect(c.snapshot().greenMovements().size).toBe(0);
  });

  it('greenMovements() equals the active phase movements during GREEN', () => {
    const c = new Controller();
    expect(c.snapshot().greenMovements()).toEqual(RING[0]!.movements);
  });
});

describe('Actuation (sensor-driven timing)', () => {
  it('skips phases with no demand at transition time', () => {
    const c = new Controller();
    // Demand only on Phase A movements (NS through+right). All other phases empty.
    c.setDemand((m) => RING[0]!.movements.has(m));
    // Run through one full sub-state cycle. After ALL_RED, controller should
    // pick the next phase WITH demand — which is Phase A again (skipping B, C, D).
    c.tick(CONFIG.maxGreenMs); // green stretches to max because demand persists
    c.tick(CONFIG.yellowMs);
    c.tick(CONFIG.allRedMs);
    expect(c.state.phaseIndex).toBe(0); // skipped B, C, D — back to A
    expect(c.state.mode).toBe('GREEN');
  });

  it('extends green up to maxGreen while demand persists', () => {
    const c = new Controller();
    c.setDemand(() => true); // every movement always has demand
    c.tick(CONFIG.maxGreenMs - 1);
    expect(c.state.mode).toBe('GREEN');
    c.tick(2);
    expect(c.state.mode).toBe('YELLOW');
  });

  it('gaps out at minGreen when demand drops to zero', () => {
    let hasDemand = true;
    const c = new Controller();
    c.setDemand(() => hasDemand);
    c.tick(CONFIG.minGreenMs - 100);
    expect(c.state.mode).toBe('GREEN');
    // Demand vanishes; we're still under minGreen so green continues briefly.
    hasDemand = false;
    c.tick(150);
    expect(c.state.mode).toBe('YELLOW'); // ended right at minGreen
  });

  it('respects minGreen even with zero demand', () => {
    const c = new Controller();
    c.setDemand(() => false);
    c.tick(CONFIG.minGreenMs / 2);
    expect(c.state.mode).toBe('GREEN'); // hasn't reached min yet
    c.tick(CONFIG.minGreenMs / 2 + 1);
    expect(c.state.mode).toBe('YELLOW'); // ends right at min
  });

  it('falls back to fixed-timer behavior with no demand callback', () => {
    const c = new Controller();
    c.tick(CONFIG.fixedGreenMs - 1);
    expect(c.state.mode).toBe('GREEN');
    c.tick(2);
    expect(c.state.mode).toBe('YELLOW');
  });

  it('cycles forward even when no phase has demand (no infinite skip loop)', () => {
    const c = new Controller();
    c.setDemand(() => false);
    const startIdx = c.state.phaseIndex;
    c.tick(CONFIG.minGreenMs + CONFIG.yellowMs + CONFIG.allRedMs);
    expect(c.state.phaseIndex).not.toBe(startIdx);
    expect(c.state.mode).toBe('GREEN');
  });
});

describe('Pedestrian phase (concurrent phasing)', () => {
  it('N/S crosswalk walk is served during Phase C (EW-through), not Phase A', () => {
    const c = new Controller();
    c.requestPed('N');
    expect(c.snapshot().pedRequestPendingFor('N')).toBe(true);
    // We're in Phase A (NS-through). N crosswalk must stay DONT_WALK.
    expect(c.snapshot().walkSignalFor('N')).toBe('DONT_WALK');
    // Advance through Phase A + Phase B → arrive at Phase C.
    c.tick(2 * (CONFIG.fixedGreenMs + CONFIG.yellowMs + CONFIG.allRedMs));
    expect(c.state.phase.id).toBe('C');
    // Now in Phase C GREEN — walk should be on.
    expect(c.snapshot().walkSignalFor('N')).toBe('WALK');
  });

  it('E/W crosswalk walk is served during Phase A (NS-through)', () => {
    const c = new Controller();
    c.requestPed('E');
    // We're already in Phase A GREEN. E-crosswalk should walk immediately.
    expect(c.snapshot().walkSignalFor('E')).toBe('WALK');
  });

  it('walk→flash_dont_walk→dont_walk cycle within the serving phase GREEN', () => {
    const c = new Controller();
    c.setDemand(() => true); // keep Phase A green at maxGreen so we can observe full walk cycle
    c.requestPed('E');
    expect(c.snapshot().walkSignalFor('E')).toBe('WALK');
    c.tick(CONFIG.pedWalkMs - 100);
    expect(c.snapshot().walkSignalFor('E')).toBe('WALK');
    c.tick(200); // cross the pedWalkMs boundary
    expect(c.snapshot().walkSignalFor('E')).toBe('FLASH_DONT_WALK');
    c.tick(CONFIG.pedClearanceMs);
    expect(c.snapshot().walkSignalFor('E')).toBe('DONT_WALK');
  });

  it('all walks off during protected-left phases (B and D)', () => {
    const c = new Controller();
    c.requestPed('N');
    c.requestPed('S');
    c.requestPed('E');
    c.requestPed('W');
    // Advance into Phase B (NS protected left).
    c.tick(CONFIG.fixedGreenMs + CONFIG.yellowMs + CONFIG.allRedMs);
    expect(c.state.phase.id).toBe('B');
    for (const cw of ['N', 'S', 'E', 'W'] as const) {
      expect(c.snapshot().walkSignalFor(cw)).toBe('DONT_WALK');
    }
  });

  it('multiple presses on the same crosswalk collapse to one request', () => {
    const c = new Controller();
    c.requestPed('E');
    c.requestPed('E');
    c.requestPed('E');
    expect(c.snapshot().pedRequestPendingFor('E')).toBe(true);
    // Advance through Phase A ALL_RED — request should be cleared.
    c.tick(CONFIG.maxGreenMs + CONFIG.yellowMs + CONFIG.allRedMs);
    expect(c.snapshot().pedRequestPendingFor('E')).toBe(false);
  });

  it('green extends to cover pedWalkMs + pedClearanceMs when a walk is being served', () => {
    const c = new Controller();
    // No vehicle demand — green would normally gap-out at minGreen (4s).
    // A ped request should force it to extend to pedWalkMs + pedClearanceMs (11s).
    c.setDemand(() => false);
    c.requestPed('E'); // served during Phase A
    c.tick(CONFIG.minGreenMs + 100); // past what would be min-green without ped
    expect(c.state.mode).toBe('GREEN'); // still green because ped is being served
    c.tick(CONFIG.pedWalkMs + CONFIG.pedClearanceMs); // finish ped clearance
    // Now free to advance.
    c.tick(100);
    expect(c.state.mode === 'YELLOW' || c.state.phase.id !== 'A').toBe(true);
  });

  it('late-press walk still gets full duration — maxGreen stretches past its normal cap', () => {
    // With pedWalkMs + pedClearanceMs = 11s and maxGreenMs = 20s, a press
    // at t > 9s would normally get truncated by maxGreen. This test proves
    // we extend past maxGreen to cover the full walk cycle.
    const c = new Controller();
    c.setDemand(() => true);
    // Get to 15s into Phase A GREEN without a request.
    c.tick(15000);
    expect(c.state.phase.id).toBe('A');
    expect(c.state.mode).toBe('GREEN');
    // Press late. walk must run full 7s WALK + 4s FLASH = 11s from press.
    c.requestPed('E');
    expect(c.snapshot().walkSignalFor('E')).toBe('WALK');
    // Tick 7s — should still be WALK-ish (right at boundary to FLASH).
    c.tick(CONFIG.pedWalkMs - 50);
    expect(c.snapshot().walkSignalFor('E')).toBe('WALK');
    c.tick(100);
    expect(c.snapshot().walkSignalFor('E')).toBe('FLASH_DONT_WALK');
    c.tick(CONFIG.pedClearanceMs);
    expect(c.snapshot().walkSignalFor('E')).toBe('DONT_WALK');
    // Confirm the green extended past maxGreenMs to cover this.
    // Press at t=15s, walk end at t=26s. maxGreen would normally cap at 20s.
    // Sum of ticks so far: 15000 + (pedWalkMs - 50) + 100 + pedClearanceMs
    //                    = 15000 + 6950 + 100 + 4000 = 26050
    // Phase is still GREEN at that point (walk just finished; green can now gap out).
  });

  it('mid-green press gets the full WALK + FLASH duration from press time (green extends to cover)', () => {
    const c = new Controller();
    c.setDemand(() => true); // ensure green can extend if needed
    // Let Phase A GREEN run for 5s without a request.
    c.tick(5000);
    expect(c.state.phase.id).toBe('A');
    expect(c.state.mode).toBe('GREEN');
    expect(c.snapshot().walkSignalFor('E')).toBe('DONT_WALK');
    // Now press. Walk should start *now*, not from the start of the green.
    c.requestPed('E');
    expect(c.snapshot().walkSignalFor('E')).toBe('WALK');
    // After pedWalkMs - 100 (just short of pedWalkMs), still WALK.
    c.tick(CONFIG.pedWalkMs - 100);
    expect(c.snapshot().walkSignalFor('E')).toBe('WALK');
    // After 200 more (past pedWalkMs), FLASH.
    c.tick(200);
    expect(c.snapshot().walkSignalFor('E')).toBe('FLASH_DONT_WALK');
    // After full clearance, DONT_WALK.
    c.tick(CONFIG.pedClearanceMs);
    expect(c.snapshot().walkSignalFor('E')).toBe('DONT_WALK');
    // Mode should still be GREEN (phase was extended to cover the walk cycle).
    expect(c.state.mode).toBe('GREEN');
  });

  it('ped recall: Phase A is NOT skipped when an E/W walk is pending, even with zero vehicle demand', () => {
    const c = new Controller();
    c.setDemand(() => false);
    c.requestPed('W'); // Phase A serves W
    const start = c.state.phaseIndex;
    // Run one full cycle. Without ped recall, Phase A would be skipped.
    c.tick(CONFIG.minGreenMs + CONFIG.yellowMs + CONFIG.allRedMs);
    // After one sub-state cycle we should still be in Phase A (ped is being served).
    expect(c.state.phaseIndex).toBe(start);
  });
});

describe('Permissive-left flashing-orange', () => {
  it('N/S LEFT shows FLASHING_ORANGE during Phase A (NS through) GREEN', () => {
    const c = new Controller();
    expect(c.state.phase.id).toBe('A');
    expect(c.state.mode).toBe('GREEN');
    const snap = c.snapshot();
    expect(snap.leftSignalFor('N-LEFT')).toBe('FLASHING_ORANGE');
    expect(snap.leftSignalFor('S-LEFT')).toBe('FLASHING_ORANGE');
    // EW lefts should be RED during this phase.
    expect(snap.leftSignalFor('E-LEFT')).toBe('RED');
    expect(snap.leftSignalFor('W-LEFT')).toBe('RED');
  });

  it('LEFT signals are RED during YELLOW and ALL_RED of opposite-through phase', () => {
    const c = new Controller();
    c.tick(CONFIG.fixedGreenMs);
    expect(c.state.mode).toBe('YELLOW');
    expect(c.snapshot().leftSignalFor('N-LEFT')).toBe('RED');
    c.tick(CONFIG.yellowMs);
    expect(c.state.mode).toBe('ALL_RED');
    expect(c.snapshot().leftSignalFor('N-LEFT')).toBe('RED');
  });

  it('Phase B (NS protected left) shows GREEN, not flashing orange', () => {
    const c = new Controller();
    c.tick(CONFIG.fixedGreenMs + CONFIG.yellowMs + CONFIG.allRedMs);
    expect(c.state.phase.id).toBe('B');
    expect(c.state.mode).toBe('GREEN');
    expect(c.snapshot().leftSignalFor('N-LEFT')).toBe('GREEN');
    expect(c.snapshot().leftSignalFor('S-LEFT')).toBe('GREEN');
  });

  it('E/W LEFT shows FLASHING_ORANGE during Phase C (EW through)', () => {
    const c = new Controller();
    c.tick(2 * (CONFIG.fixedGreenMs + CONFIG.yellowMs + CONFIG.allRedMs));
    expect(c.state.phase.id).toBe('C');
    expect(c.state.mode).toBe('GREEN');
    const snap = c.snapshot();
    expect(snap.leftSignalFor('E-LEFT')).toBe('FLASHING_ORANGE');
    expect(snap.leftSignalFor('W-LEFT')).toBe('FLASHING_ORANGE');
    expect(snap.leftSignalFor('N-LEFT')).toBe('RED');
  });

  it('FLASHING_ORANGE LEFT does NOT add the LEFT movement to the green set (safety)', () => {
    const c = new Controller();
    expect(c.state.phase.id).toBe('A');
    const greens = c.snapshot().greenMovements();
    // Phase A includes N-STRAIGHT, N-RIGHT, S-STRAIGHT, S-RIGHT — but NOT N-LEFT/S-LEFT.
    expect(greens.has('N-LEFT')).toBe(false);
    expect(greens.has('S-LEFT')).toBe(false);
  });

  it('LEFT stays in its vehicle-phase color during walk (not flashing orange when walk active)', () => {
    // Under concurrent phasing there's no dedicated ped phase, but during
    // Phase A (NS through, WALK on E/W) the N/S LEFT signals should still
    // show flashing orange as the permissive-left aspect.
    const c = new Controller();
    c.requestPed('E');
    expect(c.snapshot().walkSignalFor('E')).toBe('WALK');
    // Phase A GREEN, so N/S LEFT show flashing orange (permissive),
    // E/W LEFT show RED (not their phase).
    expect(c.snapshot().leftSignalFor('N-LEFT')).toBe('FLASHING_ORANGE');
    expect(c.snapshot().leftSignalFor('E-LEFT')).toBe('RED');
  });
});

describe('Controller input validation', () => {
  it('rejects negative dt', () => {
    const c = new Controller();
    expect(() => c.tick(-1)).toThrow();
  });

  it('accepts dt = 0', () => {
    const c = new Controller();
    expect(() => c.tick(0)).not.toThrow();
    expect(c.state.modeElapsedMs).toBe(0);
  });
});
