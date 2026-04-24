import { CONFIG, type Config } from '../config';
import { isMovementSetSafe } from './conflicts';
import { RING } from './phases';
import {
  parseMovement,
  type Approach,
  type LeftSignalColor,
  type Movement,
  type Phase,
  type SignalColor,
  type WalkSignal,
} from './types';

/** Demand callback: returns true if the movement has waiting cars (or expected arrivals). */
export type DemandFn = (m: Movement) => boolean;

const CROSSWALKS: readonly Approach[] = ['N', 'S', 'E', 'W'];

/**
 * Sub-state within a phase cycle:
 *   GREEN    → active phase movements show green
 *   YELLOW   → those movements show yellow (clearing)
 *   ALL_RED  → every vehicle signal red (clearance interval)
 *
 * The controller advances GREEN → YELLOW → ALL_RED → next phase GREEN.
 */
export type PhaseMode = 'GREEN' | 'YELLOW' | 'ALL_RED';

export interface ControllerState {
  readonly phase: Phase;
  readonly phaseIndex: number;
  readonly mode: PhaseMode;
  readonly modeElapsedMs: number;
  readonly modeDurationMs: number;
}

export interface ControllerSnapshot extends ControllerState {
  /** Vehicle signal for any movement (RED / YELLOW / GREEN). */
  signalFor(movement: Movement): SignalColor;
  /**
   * Signal for a LEFT movement, which can additionally show FLASHING_ORANGE
   * (permissive left).
   */
  leftSignalFor(movement: Movement): LeftSignalColor;
  /** Movements currently showing GREEN. */
  greenMovements(): ReadonlySet<Movement>;
  /**
   * Walk signal for a specific crosswalk. Concurrent phasing:
   *   N/S crosswalks serve during Phase C (EW-through) — peds cross the
   *     N-S road safely because NS vehicle traffic is stopped.
   *   E/W crosswalks serve during Phase A (NS-through).
   *   Protected-left phases (B/D): all walks off (turning vehicles conflict).
   */
  walkSignalFor(crosswalk: Approach): WalkSignal;
  /** Whether a pedestrian request is pending for a specific crosswalk. */
  pedRequestPendingFor(crosswalk: Approach): boolean;
}

export class Controller {
  private phaseIndex = 0;
  private mode: PhaseMode = 'GREEN';
  private modeElapsedMs = 0;
  private demand?: DemandFn;
  /** Per-crosswalk walk requests. Set by pressing the button, cleared after service. */
  private pedRequests: Record<Approach, boolean> = { N: false, S: false, E: false, W: false };
  /**
   * When the walk signal started for this crosswalk, measured in modeElapsedMs
   * of the current serving GREEN. `null` when no walk in progress. Tracked
   * independently from phase start so a mid-green press gets the full
   * walk+clearance duration (not whatever is left in the phase).
   */
  private walkStartedAt: Record<Approach, number | null> = { N: null, S: null, E: null, W: null };

  constructor(private readonly cfg: Config = CONFIG) {}

  /**
   * Request a walk signal for the given crosswalk. Concurrent phasing:
   * the request is served during the *parallel* vehicle phase (NS-through
   * for E/W crosswalks, EW-through for N/S crosswalks). Never preempts —
   * the ped waits until the parallel phase cycles around naturally.
   */
  requestPed(crosswalk: Approach): void {
    this.pedRequests[crosswalk] = true;
    this.updateWalkStarts();
  }

  /**
   * For each crosswalk, refresh the walk-start timestamp: if we're currently
   * in its serving GREEN and the request is pending, mark the walk as starting
   * "now" (at the current modeElapsedMs). Otherwise clear the start timestamp
   * so a fresh serving GREEN begins the walk cleanly.
   */
  private updateWalkStarts(): void {
    for (const cw of CROSSWALKS) {
      const servingId = this.servingPhaseIdFor(cw);
      const isServing = this.currentPhase.id === servingId && this.mode === 'GREEN';
      if (!isServing) {
        this.walkStartedAt[cw] = null;
        continue;
      }
      if (!this.pedRequests[cw]) continue;
      // Start walk on first tick of serving GREEN with a pending request.
      if (this.walkStartedAt[cw] === null) {
        this.walkStartedAt[cw] = this.modeElapsedMs;
        continue;
      }
      // Walk complete → clear the request so ped recall doesn't keep green forever.
      const walkElapsed = this.modeElapsedMs - this.walkStartedAt[cw]!;
      if (walkElapsed >= this.cfg.pedWalkMs + this.cfg.pedClearanceMs) {
        this.pedRequests[cw] = false;
        this.walkStartedAt[cw] = null;
      }
    }
  }

  /**
   * Wire up sensor-driven actuation. With a demand callback, the controller:
   *   - **skips** any phase whose movements have no demand at the moment of transition
   *   - **extends** a green up to `maxGreenMs` while its phase has demand
   *   - **gaps out** at `minGreenMs` when its phase loses demand
   * Without a demand callback, falls back to `fixedGreenMs` for every phase.
   */
  setDemand(demand: DemandFn | undefined): void {
    this.demand = demand;
  }

  get state(): ControllerState {
    return {
      phase: this.currentPhase,
      phaseIndex: this.phaseIndex,
      mode: this.mode,
      modeElapsedMs: this.modeElapsedMs,
      modeDurationMs: this.modeDuration,
    };
  }

  snapshot(): ControllerSnapshot {
    const greens = this.greenMovementsInternal();
    return {
      ...this.state,
      signalFor: (m) => this.signalFor(m, greens),
      leftSignalFor: (m) => this.leftSignalFor(m, greens),
      greenMovements: () => greens,
      walkSignalFor: (c) => this.computeWalkSignalFor(c),
      pedRequestPendingFor: (c) => this.pedRequests[c],
    };
  }

  /** Which vehicle phase is parallel to (and therefore serves) this crosswalk. */
  private servingPhaseIdFor(crosswalk: Approach): Phase['id'] {
    // N/S crosswalks span the N-S road; peds walk E-W → safe during EW-through (Phase C).
    // E/W crosswalks span the E-W road; peds walk N-S → safe during NS-through (Phase A).
    return crosswalk === 'N' || crosswalk === 'S' ? 'C' : 'A';
  }

  private computeWalkSignalFor(crosswalk: Approach): WalkSignal {
    const servingId = this.servingPhaseIdFor(crosswalk);
    if (this.currentPhase.id !== servingId) return 'DONT_WALK';
    if (this.mode !== 'GREEN') return 'DONT_WALK';
    if (!this.pedRequests[crosswalk]) return 'DONT_WALK';
    const walkStart = this.walkStartedAt[crosswalk];
    if (walkStart === null) return 'DONT_WALK';
    const walkElapsed = this.modeElapsedMs - walkStart;
    if (walkElapsed < this.cfg.pedWalkMs) return 'WALK';
    if (walkElapsed < this.cfg.pedWalkMs + this.cfg.pedClearanceMs) return 'FLASH_DONT_WALK';
    return 'DONT_WALK';
  }

  /** Advance simulation by `dtMs` milliseconds. */
  tick(dtMs: number): void {
    if (dtMs < 0) throw new Error(`negative dt: ${dtMs}`);
    let remaining = dtMs;
    // Loop in case dt overshoots multiple sub-states (long pauses, debugging).
    while (remaining > 0) {
      const target = this.computeTargetDuration();
      // Already past target (e.g., demand just dropped below the actuated cutoff).
      if (this.modeElapsedMs >= target) {
        this.advance();
        this.updateWalkStarts();
        continue;
      }
      const room = target - this.modeElapsedMs;
      if (remaining < room) {
        this.modeElapsedMs += remaining;
        remaining = 0;
      } else {
        remaining -= room;
        this.modeElapsedMs = target;
        this.advance();
        this.updateWalkStarts();
      }
    }
    this.updateWalkStarts();
  }

  private advance(): void {
    switch (this.mode) {
      case 'GREEN':
        this.mode = 'YELLOW';
        this.modeElapsedMs = 0;
        return;
      case 'YELLOW':
        this.mode = 'ALL_RED';
        this.modeElapsedMs = 0;
        return;
      case 'ALL_RED': {
        // Clear any walk requests that were served by the phase we're
        // leaving. Concurrent phasing — each phase's ALL_RED marks the
        // handoff point.
        const endingId = this.currentPhase.id;
        if (endingId === 'A') {
          this.pedRequests.E = false;
          this.pedRequests.W = false;
        } else if (endingId === 'C') {
          this.pedRequests.N = false;
          this.pedRequests.S = false;
        }
        this.advanceToNextVehiclePhase();
        return;
      }
    }
  }

  private advanceToNextVehiclePhase(): void {
    let nextIdx = (this.phaseIndex + 1) % RING.length;
    if (this.demand) {
      for (let attempts = 0; attempts < RING.length; attempts++) {
        if (this.phaseHasDemand(RING[nextIdx]!)) break;
        nextIdx = (nextIdx + 1) % RING.length;
      }
    }
    this.phaseIndex = nextIdx;
    this.mode = 'GREEN';
    this.modeElapsedMs = 0;
  }

  private phaseHasDemand(phase: Phase): boolean {
    // Ped recall: a pending walk request that this phase serves counts as
    // demand — don't skip the phase even if no vehicles are waiting.
    if (phase.id === 'A' && (this.pedRequests.E || this.pedRequests.W)) return true;
    if (phase.id === 'C' && (this.pedRequests.N || this.pedRequests.S)) return true;
    // Vehicle demand.
    if (!this.demand) return true;
    for (const m of phase.movements) if (this.demand(m)) return true;
    return false;
  }

  private get currentPhase(): Phase {
    return RING[this.phaseIndex]!;
  }

  private get modeDuration(): number {
    return this.computeTargetDuration();
  }

  /**
   * Target duration for the current sub-state, recomputed each tick.
   * Vehicle GREEN duration is dynamic under actuation, and floored by
   * the ped-clearance requirement when the phase is serving a walk request
   * (so a 4-second min-green can't truncate an 11-second walk+flash).
   */
  private computeTargetDuration(): number {
    switch (this.mode) {
      case 'YELLOW': return this.cfg.yellowMs;
      case 'ALL_RED': return this.cfg.allRedMs;
      case 'GREEN': {
        if (!this.demand) return this.cfg.fixedGreenMs;
        // Ped-serve constraint: the phase must last until the *latest* walk
        // has completed its WALK + CLEARANCE from wherever it started. This
        // also *stretches maxGreen* — a late-press walk would otherwise be
        // truncated when green hits its normal cap.
        let pedFloor = 0;
        for (const cw of CROSSWALKS) {
          if (!this.pedRequests[cw]) continue;
          if (this.currentPhase.id !== this.servingPhaseIdFor(cw)) continue;
          const walkStart = this.walkStartedAt[cw] ?? this.modeElapsedMs;
          const walkEnd = walkStart + this.cfg.pedWalkMs + this.cfg.pedClearanceMs;
          if (walkEnd > pedFloor) pedFloor = walkEnd;
        }
        const effectiveMax = Math.max(this.cfg.maxGreenMs, pedFloor);
        const minGreen = Math.max(this.cfg.minGreenMs, pedFloor);
        if (this.modeElapsedMs >= effectiveMax) return effectiveMax;
        if (this.phaseHasDemand(this.currentPhase)) return effectiveMax;
        // Demand dropped → gap out, but not before the minimum.
        return Math.max(this.modeElapsedMs, minGreen);
      }
    }
  }


  private greenMovementsInternal(): ReadonlySet<Movement> {
    if (this.mode === 'GREEN') return this.currentPhase.movements;
    return new Set();
  }

  private signalFor(m: Movement, greens: ReadonlySet<Movement>): SignalColor {
    if (greens.has(m)) return 'GREEN';
    if (this.mode === 'YELLOW' && this.currentPhase.movements.has(m)) return 'YELLOW';
    return 'RED';
  }

  private leftSignalFor(m: Movement, greens: ReadonlySet<Movement>): LeftSignalColor {
    const { kind, approach } = parseMovement(m);
    if (kind !== 'LEFT') return this.signalFor(m, greens);

    // Permissive (FLASHING_ORANGE) left during the *opposite-through* phase:
    //   N/S-LEFT shows flashing orange during Phase A (NS through, GREEN sub-mode)
    //   E/W-LEFT shows flashing orange during Phase C (EW through, GREEN sub-mode)
    // The signal communicates "yield to oncoming and turn if clear" — but the
    // movement is NOT in the green set (no right-of-way), so the global safety
    // invariant still holds.
    if (this.mode === 'GREEN') {
      const phaseId = this.currentPhase.id;
      const onNSThrough = phaseId === 'A' && (approach === 'N' || approach === 'S');
      const onEWThrough = phaseId === 'C' && (approach === 'E' || approach === 'W');
      if (onNSThrough || onEWThrough) return 'FLASHING_ORANGE';
    }
    return this.signalFor(m, greens);
  }
}

/** Defensive sanity check used by the property test. */
export function snapshotIsSafe(snap: ControllerSnapshot): { ok: true } | { ok: false; conflict: [Movement, Movement] } {
  return isMovementSetSafe(snap.greenMovements());
}
