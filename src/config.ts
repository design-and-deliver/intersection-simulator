/** All tunables in one place — easy to tweak the demo, easy to reason about. */
export const CONFIG = {
  /** Minimum green time per phase before actuation can end it (ms). */
  minGreenMs: 4000,
  /** Hard cap on a single green phase (ms). */
  maxGreenMs: 20000,
  /** Default fixed green time when actuation is not in play (step 2 only). */
  fixedGreenMs: 8000,
  /** Each detected vehicle extends green by this much, up to maxGreenMs. */
  gapExtensionMs: 2000,

  /** Yellow interval following any green→red transition (ms). */
  yellowMs: 2500,
  /** All-red clearance interval between phases (ms). */
  allRedMs: 1500,

  /** Pedestrian WALK signal duration (ms). */
  pedWalkMs: 10000,
  /** Pedestrian flashing-DON'T-WALK clearance (ms). */
  pedClearanceMs: 4000,

  /** Headway between successive cars served at a green light (ms). */
  serviceHeadwayMs: 1800,
  /** Default per-lane arrivals per minute. Overridable per lane. */
  defaultArrivalsPerMin: 12,
} as const;

export type Config = typeof CONFIG;
