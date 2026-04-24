import { CONFIG, type Config } from '../config';
import { Controller, type ControllerSnapshot } from './controller';
import { Lanes, TRANSIT_MS, type ArrivalRates, type Car } from './cars';
import { mulberry32, type Rng } from './rng';
import { OPPOSITE, type Approach, type Movement } from './types';

/**
 * Driver's risk tolerance for permissive left turns — the maximum acceptable
 * probability of an opposing arrival during the turn's transit. Real US
 * drivers accept gaps with ~30–50% arrival probability; 0.50 approximates
 * that. Lower values (0.10–0.20) model a cautious driver; higher values
 * (0.60+) model an aggressive one. Spec says "go if no cars are coming the
 * other way" — a numeric threshold is a gap-acceptance model of that phrase.
 */
const PERMISSIVE_LOOKAHEAD_RISK = 0.50;

const LEFT_MOVEMENTS: readonly Movement[] = ['N-LEFT', 'S-LEFT', 'E-LEFT', 'W-LEFT'];

/** The opposing-through movement for a given LEFT — the one whose path the LEFT crosses. */
function opposingThroughFor(leftMv: Movement): Movement {
  const approach = leftMv.split('-')[0] as Approach;
  return `${OPPOSITE[approach]}-STRAIGHT` as Movement;
}

export interface WorldOptions {
  cfg?: Config;
  rng?: Rng;
  seed?: number;
  arrivalRates?: ArrivalRates;
}

/**
 * Top-level simulation. Composes the controller (signal state machine) with the
 * per-lane car queues. Pure-tick: inject `dt` from the renderer's RAF loop or a test.
 *
 *      ___________
 *     /  ____  __ \      <-- ASCII car (per spec)
 *    / _/ __ \/_  \\
 *   |__/    \____/ |
 *   (_)            (_)
 */
export class World {
  readonly controller: Controller;
  readonly lanes: Lanes;
  private nowMs = 0;

  constructor(opts: WorldOptions = {}) {
    const cfg = opts.cfg ?? CONFIG;
    const rng = opts.rng ?? mulberry32(opts.seed ?? 1);
    this.controller = new Controller(cfg);
    this.lanes = new Lanes(cfg, rng, opts.arrivalRates);
    // Wire actuation: the controller asks lanes for per-movement demand to
    // skip empty phases and extend greens while demand persists.
    this.controller.setDemand((m) => this.lanes.hasDemand(m));
  }

  get timeMs(): number {
    return this.nowMs;
  }

  tick(dtMs: number): { released: readonly Car[] } {
    if (dtMs < 0) throw new Error(`negative dt: ${dtMs}`);
    this.nowMs += dtMs;
    this.controller.tick(dtMs);
    const snap = this.controller.snapshot();
    // Strict greens (full right-of-way) plus permissive-left cars whose
    // opposing-through is currently clear (no queue, nothing in flight on its path).
    const releasable = new Set(snap.greenMovements());
    for (const m of LEFT_MOVEMENTS) {
      if (snap.leftSignalFor(m) !== 'FLASHING_ORANGE') continue;
      if (this.isOpposingThroughClear(m)) releasable.add(m);
    }
    const released = this.lanes.tick(dtMs, this.nowMs, releasable);
    return { released };
  }

  /**
   * "Clear enough to permissive-turn" check, with two layers:
   *
   *   1. *Snapshot:* opposing through has nothing waiting and nothing in flight
   *      right now — necessary but not sufficient.
   *   2. *Lookahead:* given the configured Poisson arrival rate for opposing,
   *      compute the probability that an opposing car arrives during the LEFT
   *      car's transit. Refuse if it exceeds PERMISSIVE_LOOKAHEAD_RISK. This
   *      catches the case where opposing is *currently* empty but its arrival
   *      rate is so high that an arrival mid-turn is likely.
   *
   * Real drivers don't compute Poisson probabilities — they judge by sustained
   * traffic density. The lookahead is a tractable approximation: if cars are
   * configured to arrive every 5 seconds on opposing, a 4-second turn is
   * unsafe regardless of what the current snapshot says.
   */
  private isOpposingThroughClear(leftMv: Movement): boolean {
    const opp = opposingThroughFor(leftMv);
    // Snapshot check.
    if (this.lanes.queue(opp).length > 0) return false;
    for (const car of this.lanes.inFlight) {
      if (car.lane === opp) return false;
    }
    // Lookahead check.
    const ratePerMin = this.lanes.arrivalRatePerMin(opp);
    if (ratePerMin > 0) {
      const ratePerMs = ratePerMin / 60_000;
      // P(at least one arrival in time T) = 1 - e^(-λT) for Poisson process.
      const probArrival = 1 - Math.exp(-ratePerMs * TRANSIT_MS.LEFT);
      if (probArrival > PERMISSIVE_LOOKAHEAD_RISK) return false;
    }
    return true;
  }

  snapshot(): {
    timeMs: number;
    controller: ControllerSnapshot;
    queues: Record<Movement, number>;
  } {
    const controller = this.controller.snapshot();
    const queues = {} as Record<Movement, number>;
    for (const [m, s] of Object.entries(this.lanes.allStats())) {
      queues[m as Movement] = s.queueLength;
    }
    return { timeMs: this.nowMs, controller, queues };
  }
}
