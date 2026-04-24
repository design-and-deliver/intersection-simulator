import { CONFIG, type Config } from '../config';
import { exponentialMs, type Rng } from './rng';
import { ALL_MOVEMENTS, parseMovement, type Movement } from './types';

export interface Car {
  readonly id: number;
  readonly lane: Movement;
  readonly arrivedAtMs: number;
  /**
   * Which physical sub-lane this car uses, when the movement spans more than one
   * lane (STRAIGHT has two; LEFT/RIGHT have one). Assigned at arrival time so
   * the car's queued position is stable as the queue ahead of it shifts.
   */
  readonly subLaneIndex: number;
  /** Absolute sim time when the car was released into the intersection. */
  servedAtMs?: number;
  /** Same as servedAtMs; kept for naming clarity at the renderer call site. */
  releasedAtMs?: number;
}

/**
 * Number of physical sub-lanes per movement kind.
 *   LEFT     → 1 (single left-turn lane)
 *   STRAIGHT → 2 (two middle through lanes)
 *   RIGHT    → 1 (single right-turn lane)
 */
function subLanesFor(m: Movement): number {
  const { kind } = parseMovement(m);
  return kind === 'STRAIGHT' ? 2 : 1;
}

export interface LaneStats {
  readonly queueLength: number;
  readonly totalArrived: number;
  readonly totalServed: number;
  /** Sum of (servedAt - arrivedAt) for served cars, in ms. */
  readonly totalWaitMs: number;
}

class Lane {
  queue: Car[] = [];
  totalArrived = 0;
  totalServed = 0;
  totalWaitMs = 0;
  private arrivalsPerMin: number;
  /** Time until the next Poisson arrival (ms). Re-sampled when ≤ 0. */
  private timeUntilNextArrivalMs = 0;
  /** Cooldown until each sub-lane can release its next car (per-sub-lane = parallel service). */
  private serviceCooldownMsPerSub: number[];
  /** Last release time per sub-lane (renderer uses this to delay visual queue shift). */
  lastReleaseAtMsPerSub: (number | null)[];
  /** Round-robin counter assigning new arrivals to a sub-lane. */
  private nextSubLane = 0;
  private readonly numSubLanes: number;

  constructor(
    readonly movement: Movement,
    arrivalsPerMin: number,
    private readonly cfg: Config,
    rng: Rng,
  ) {
    this.arrivalsPerMin = arrivalsPerMin;
    this.numSubLanes = subLanesFor(movement);
    this.serviceCooldownMsPerSub = new Array(this.numSubLanes).fill(0);
    this.lastReleaseAtMsPerSub = new Array(this.numSubLanes).fill(null);
    this.timeUntilNextArrivalMs = exponentialMs(rng, this.arrivalsPerMin);
  }

  setArrivalRate(perMin: number, rng: Rng): void {
    this.arrivalsPerMin = perMin;
    this.timeUntilNextArrivalMs = exponentialMs(rng, perMin);
  }

  get ratePerMin(): number {
    return this.arrivalsPerMin;
  }

  /**
   * Advance arrivals by `dtMs`. Each completed inter-arrival appends a Car.
   * Cars are stamped with the absolute sim time at which they arrived
   * (computed from `nowMs - leftoverDt` when arrivals stack up within one tick).
   */
  tickArrivals(dtMs: number, nowMs: number, rng: Rng, nextId: () => number): void {
    let remaining = dtMs;
    let elapsed = 0;
    while (remaining > 0) {
      if (this.timeUntilNextArrivalMs > remaining) {
        this.timeUntilNextArrivalMs -= remaining;
        return;
      }
      elapsed += this.timeUntilNextArrivalMs;
      remaining -= this.timeUntilNextArrivalMs;
      const arrivedAtMs = nowMs - dtMs + elapsed;
      const subLaneIndex = this.nextSubLane;
      this.nextSubLane = (this.nextSubLane + 1) % this.numSubLanes;
      this.queue.push({
        id: nextId(),
        lane: this.movement,
        arrivedAtMs,
        subLaneIndex,
      });
      this.totalArrived += 1;
      this.timeUntilNextArrivalMs = exponentialMs(rng, this.arrivalsPerMin);
    }
  }

  /**
   * Serve queued cars while the light is green. Returns released cars in order.
   * If the lane is not green, the cooldown is held at 0 so the first car can
   * release immediately when green begins.
   */
  tickService(dtMs: number, nowMs: number, isGreen: boolean): Car[] {
    if (!isGreen) {
      // Hold cooldowns at zero so each sub-lane can release immediately when green.
      for (let i = 0; i < this.numSubLanes; i++) this.serviceCooldownMsPerSub[i] = 0;
      return [];
    }
    for (let i = 0; i < this.numSubLanes; i++) this.serviceCooldownMsPerSub[i]! -= dtMs;

    const released: Car[] = [];
    // Each sub-lane services its own front car independently (parallel service).
    // Loop until no sub-lane can release another car this tick.
    while (true) {
      let madeProgress = false;
      for (let sub = 0; sub < this.numSubLanes; sub++) {
        if (this.serviceCooldownMsPerSub[sub]! > 0) continue;
        // Front car of this sub-lane = first car in queue with matching subLaneIndex.
        const idx = this.queue.findIndex((c) => c.subLaneIndex === sub);
        if (idx === -1) continue;
        const front = this.queue[idx]!;
        // Don't release until the slide-in animation is complete.
        if (nowMs - front.arrivedAtMs < APPROACH_MS) continue;
        // Release.
        this.queue.splice(idx, 1);
        const tStamp = nowMs + this.serviceCooldownMsPerSub[sub]!;
        front.servedAtMs = tStamp;
        front.releasedAtMs = tStamp;
        this.lastReleaseAtMsPerSub[sub] = tStamp;
        this.totalServed += 1;
        this.totalWaitMs += tStamp - front.arrivedAtMs;
        released.push(front);
        this.serviceCooldownMsPerSub[sub]! += SERVICE_HEADWAY_MS[parseMovement(this.movement).kind];
        madeProgress = true;
      }
      if (!madeProgress) break;
    }

    // Clamp negative cooldowns when nothing's queued so we don't accumulate slack.
    for (let sub = 0; sub < this.numSubLanes; sub++) {
      const idx = this.queue.findIndex((c) => c.subLaneIndex === sub);
      if (idx === -1 && this.serviceCooldownMsPerSub[sub]! < 0) {
        this.serviceCooldownMsPerSub[sub] = 0;
      }
    }
    return released;
  }

  stats(): LaneStats {
    return {
      queueLength: this.queue.length,
      totalArrived: this.totalArrived,
      totalServed: this.totalServed,
      totalWaitMs: this.totalWaitMs,
    };
  }

  /** Read-only sensor signal: are there cars waiting (or arriving very soon)? */
  hasDemand(): boolean {
    return this.queue.length > 0;
  }
}

export type ArrivalRates = Partial<Record<Movement, number>>;

/**
 * Per-lane-kind transit time from stop line all the way off-screen (ms).
 * Tuned so cars travel at ~visually-natural city speed. Turns take longer
 * because the path through the bezier arc + outbound run is longer.
 */
export const TRANSIT_MS: Record<'LEFT' | 'STRAIGHT' | 'RIGHT', number> = {
  STRAIGHT: 7035,
  LEFT: 8910,
  RIGHT: 4350,  // RIGHT path is ~62% the length of STRAIGHT; scale time to keep speed comparable
};

/**
 * Time between a car's arrival and when it has fully "slid into" its queue
 * slot. The renderer animates the slide-in over this duration; the service
 * loop refuses to release a car until this much time has elapsed (so a car
 * served immediately on arrival doesn't visually teleport from mid-slide to
 * the intersection bezier).
 */
export const APPROACH_MS = 1875;

/**
 * Service headway per lane kind — time between successive releases on the
 * *same* sub-lane. LEFT is larger because left-turning cars take longer to
 * clear the intersection; a 1.8s headway would let the next LEFT car start
 * while the previous one was still ~25px into its turn, risking a visual
 * rear-end. Real intersections follow the same pattern.
 */
export const SERVICE_HEADWAY_MS: Record<'LEFT' | 'STRAIGHT' | 'RIGHT', number> = {
  STRAIGHT: 1800,
  LEFT: 2500,
  RIGHT: 2000,
};

/**
 * Visual delay before the queue appears to "shift" after a car releases.
 * Matches the per-kind service headway so the next release lines up with
 * the visual shift — clean one-car-at-a-time cycling.
 */
export const VISUAL_QUEUE_SHIFT_DELAY_MS = SERVICE_HEADWAY_MS;

export class Lanes {
  private readonly lanes = new Map<Movement, Lane>();
  private nextCarId = 1;
  /** Cars currently traversing the intersection (rendered in flight). */
  inFlight: Car[] = [];

  constructor(
    private readonly cfg: Config = CONFIG,
    private readonly rng: Rng,
    rates: ArrivalRates = {},
  ) {
    for (const m of ALL_MOVEMENTS) {
      const rate = rates[m] ?? cfg.defaultArrivalsPerMin;
      this.lanes.set(m, new Lane(m, rate, cfg, rng));
    }
  }

  setRate(m: Movement, perMin: number): void {
    this.lanes.get(m)!.setArrivalRate(perMin, this.rng);
  }

  /**
   * Tick arrivals for every lane and service whichever lanes are currently green.
   * Returns the cars released this tick (useful for animation hooks).
   */
  tick(
    dtMs: number,
    nowMs: number,
    greenMovements: ReadonlySet<Movement>,
  ): readonly Car[] {
    const released: Car[] = [];
    for (const lane of this.lanes.values()) {
      lane.tickArrivals(dtMs, nowMs, this.rng, () => this.nextCarId++);
      const out = lane.tickService(dtMs, nowMs, greenMovements.has(lane.movement));
      released.push(...out);
    }
    this.inFlight.push(...released);
    // Expire cars that have completed their transit through the intersection.
    if (this.inFlight.length > 0) {
      this.inFlight = this.inFlight.filter((c) => {
        const released = c.releasedAtMs ?? 0;
        const transit = TRANSIT_MS[parseMovement(c.lane).kind];
        return nowMs - released < transit;
      });
    }
    return released;
  }

  queue(m: Movement): readonly Car[] {
    return this.lanes.get(m)!.queue;
  }

  stats(m: Movement): LaneStats {
    return this.lanes.get(m)!.stats();
  }

  allStats(): Record<Movement, LaneStats> {
    const out = {} as Record<Movement, LaneStats>;
    for (const [m, lane] of this.lanes) out[m] = lane.stats();
    return out;
  }

  hasDemand(m: Movement): boolean {
    return this.lanes.get(m)!.hasDemand();
  }

  /** Configured arrival rate for a movement, in cars per minute. */
  arrivalRatePerMin(m: Movement): number {
    return this.lanes.get(m)!.ratePerMin;
  }

  /** Most recent release time on the given (movement, sub-lane), or null if never. */
  lastReleaseAtMs(m: Movement, subLane: number): number | null {
    return this.lanes.get(m)!.lastReleaseAtMsPerSub[subLane] ?? null;
  }
}
