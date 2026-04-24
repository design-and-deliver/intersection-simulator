import type { Approach, LaneKind, Movement } from '../sim/types';

/**
 * All geometry constants live here so the renderer is just `(state) → pixels`.
 * Coordinate system: canvas-space, +x right, +y down. Origin top-left.
 *
 * Layout:
 *   - 800×800 canvas
 *   - intersection box centered at (400, 400), 200×200
 *   - each road is 4-lane × 2-direction = 8 lanes × 25px = 200px wide
 *   - lane assignment follows US right-hand drive conventions:
 *
 *   N approach (cars from N going S, on west half of N-S road):
 *     west→east lanes: RIGHT, STRAIGHT, STRAIGHT, LEFT
 *   S approach (cars from S going N, on east half):
 *     west→east lanes: LEFT, STRAIGHT, STRAIGHT, RIGHT
 *   E approach (cars from E going W, on north half of E-W road):
 *     north→south lanes: RIGHT, STRAIGHT, STRAIGHT, LEFT
 *   W approach (cars from W going E, on south half):
 *     north→south lanes: LEFT, STRAIGHT, STRAIGHT, RIGHT
 */

export const CANVAS = 800;
export const CENTER = CANVAS / 2;
export const HALF_INTERSECTION = 100;
export const LANE_WIDTH = 25;
export const LANES_PER_DIRECTION = 4;
export const HALF_ROAD = LANE_WIDTH * LANES_PER_DIRECTION; // 100
export const ROAD_WIDTH = HALF_ROAD * 2;                     // 200

export const STOP_LINES = {
  N: CENTER - HALF_INTERSECTION,   // y = 300
  S: CENTER + HALF_INTERSECTION,   // y = 500
  E: CENTER + HALF_INTERSECTION,   // x = 500
  W: CENTER - HALF_INTERSECTION,   // x = 300
} as const;

export interface Vec {
  x: number;
  y: number;
}

export interface LaneGeom {
  /** Center of the lane at the stop line. */
  stopLineCenter: Vec;
  /** Unit vector pointing in the direction cars travel toward the intersection. */
  travelDir: Vec;
  /** Unit vector pointing the direction queued cars stack (away from intersection). */
  queueDir: Vec;
  /** Where the signal head for this lane is drawn (slightly offset to the right of the stop line). */
  signalHead: Vec;
}

export const CAR_LENGTH = 22;
export const CAR_WIDTH = 14;
export const CAR_GAP = 6;

/**
 * For each (approach, kind), return the set of physical lane indices it spans.
 * Indices are measured from the centerline of the road outward
 * (so index 0 = innermost = LEFT, index 3 = curbside = RIGHT).
 */
export function laneIndicesForKind(kind: LaneKind): readonly number[] {
  switch (kind) {
    case 'LEFT':
      return [0];
    case 'STRAIGHT':
      return [1, 2];
    case 'RIGHT':
      return [3];
  }
}

/** Number of physical sub-lanes for a movement kind. */
export function subLaneCount(kind: LaneKind): number {
  return laneIndicesForKind(kind).length;
}

/** Center of a lane at the stop line, given approach and the lane index from centerline outward. */
function laneCenterAtStopLine(approach: Approach, indexFromCenter: number): Vec {
  // Lane center offset from the centerline (in the direction perpendicular to travel).
  // index 0 → LANE_WIDTH/2, index 1 → 3·LANE_WIDTH/2, etc.
  const offsetFromCenterline = (indexFromCenter + 0.5) * LANE_WIDTH;

  switch (approach) {
    case 'N': {
      // West half of the N-S road; centerline is x=CENTER, west of it is the southbound traffic.
      // index 0 (LEFT) is closest to centerline → x = CENTER - LANE_WIDTH/2.
      // index 3 (RIGHT) is farthest west → x = CENTER - 3.5·LANE_WIDTH.
      const x = CENTER - offsetFromCenterline;
      const y = STOP_LINES.N;
      return { x, y };
    }
    case 'S': {
      // East half; LEFT closest to centerline = east of x=CENTER.
      const x = CENTER + offsetFromCenterline;
      const y = STOP_LINES.S;
      return { x, y };
    }
    case 'E': {
      // North half of the E-W road; LEFT closest to centerline = north of y=CENTER... wait
      // facing west: left side of driver = south. So LEFT lane is south of the north half.
      // The north half is y∈[CENTER-HALF_ROAD, CENTER]. LEFT (index 0) closest to centerline (y=CENTER).
      const x = STOP_LINES.E;
      const y = CENTER - offsetFromCenterline;
      return { x, y };
    }
    case 'W': {
      // South half; facing east: left = north. LEFT closest to centerline (y=CENTER) on south half.
      const x = STOP_LINES.W;
      const y = CENTER + offsetFromCenterline;
      return { x, y };
    }
  }
}

const TRAVEL_DIRS: Record<Approach, Vec> = {
  N: { x: 0, y: 1 },   // cars from N travel south
  S: { x: 0, y: -1 },  // cars from S travel north
  E: { x: -1, y: 0 },  // cars from E travel west
  W: { x: 1, y: 0 },   // cars from W travel east
};

/** Geometry for a single (approach, kind). For STRAIGHT, returns the inner straight lane. */
export function laneGeometry(approach: Approach, kind: LaneKind): LaneGeom {
  const indices = laneIndicesForKind(kind);
  const indexFromCenter = indices[0]!; // inner lane for STRAIGHT
  const center = laneCenterAtStopLine(approach, indexFromCenter);
  const travel = TRAVEL_DIRS[approach];
  const queueDir = { x: -travel.x, y: -travel.y };

  return {
    stopLineCenter: center,
    travelDir: travel,
    queueDir,
    signalHead: signalHeadPosition(approach, kind),
  };
}

/** All lane indices for a (approach, kind) — STRAIGHT yields two, others yield one. */
export function laneCenters(approach: Approach, kind: LaneKind): Vec[] {
  return laneIndicesForKind(kind).map((idx) => laneCenterAtStopLine(approach, idx));
}

/** Center of a specific sub-lane at the stop line. `subLaneIndex` is 0..(N-1) where N = subLaneCount(kind). */
export function subLaneCenterAtStopLine(approach: Approach, kind: LaneKind, subLaneIndex: number): Vec {
  const indices = laneIndicesForKind(kind);
  const idx = indices[subLaneIndex] ?? indices[0]!;
  return laneCenterAtStopLine(approach, idx);
}

/**
 * Signal head placement — one fixture per approach, **centered over the
 * lane group**, with the two heads grouped close together as a single
 * recognizable unit. Heads themselves are horizontal (lights arranged
 * left-to-right along the x-axis), which gives a clearer directional
 * association than vertical housings in a top-down view.
 *
 * Within each fixture: LEFT head on the visual left (or top, for E/W),
 * through head on the visual right (or bottom). Consistent across all
 * four fixtures so they all read the same at a glance.
 */
const FAR_PAST = 30;          // distance past the far stop line
const HORIZ_OFFSET = 14;      // x-offset for N/S heads (vertical heads, side-by-side in x)
const STACK_OFFSET = 13;      // y-offset for E/W heads (horizontal heads, stacked in y)

interface FixtureLayout {
  leftPos: Vec;
  throughPos: Vec;
  poleAt: Vec;
}

function fixtureLayout(approach: Approach): FixtureLayout {
  switch (approach) {
    case 'N': {
      // Lanes on west half. Fixture centered over the lane group, south of intersection.
      const fxC = CENTER - HALF_ROAD / 2;
      const y = STOP_LINES.S + FAR_PAST;
      return {
        throughPos: { x: fxC - HORIZ_OFFSET, y }, // visual left
        leftPos:    { x: fxC + HORIZ_OFFSET, y }, // visual right
        poleAt:     { x: STOP_LINES.W, y: STOP_LINES.S },
      };
    }
    case 'S': {
      // Lanes on east half. Centered over east-half lane group, north of intersection.
      const fxC = CENTER + HALF_ROAD / 2;
      const y = STOP_LINES.N - FAR_PAST;
      return {
        leftPos:    { x: fxC - HORIZ_OFFSET, y },
        throughPos: { x: fxC + HORIZ_OFFSET, y },
        poleAt:     { x: STOP_LINES.E, y: STOP_LINES.N },
      };
    }
    case 'E': {
      // Lanes on north half. Fixture west of intersection. Heads stacked vertically (since each head is horizontal).
      const fxC = CENTER - HALF_ROAD / 2;
      const x = STOP_LINES.W - FAR_PAST;
      return {
        throughPos: { x, y: fxC - STACK_OFFSET },     // visual top
        leftPos:    { x, y: fxC + STACK_OFFSET },     // visual bottom
        poleAt:     { x: STOP_LINES.W, y: STOP_LINES.N },
      };
    }
    case 'W': {
      const fxC = CENTER + HALF_ROAD / 2;
      const x = STOP_LINES.E + FAR_PAST;
      return {
        leftPos:    { x, y: fxC - STACK_OFFSET },     // visual top
        throughPos: { x, y: fxC + STACK_OFFSET },     // visual bottom
        poleAt:     { x: STOP_LINES.E, y: STOP_LINES.S },
      };
    }
  }
}

export function signalHeadPosition(approach: Approach, kind: LaneKind): Vec {
  const f = fixtureLayout(approach);
  return kind === 'LEFT' ? f.leftPos : f.throughPos;
}

/** Anchor point of the corner pole that the gantry arm is "mounted" on. */
export function signalPolePosition(approach: Approach): Vec {
  return fixtureLayout(approach).poleAt;
}

/** All signal housings render upright (no rotation) — the recognizable stoplight form. */
export function signalHousingRotation(_approach: Approach): number {
  return 0;
}

/** Position of the i-th queued car (i=0 closest to stop line) in lane (approach, kind). */
export function queuedCarPosition(approach: Approach, kind: LaneKind, i: number): Vec {
  return queuedCarPositionInSubLane(approach, kind, 0, i);
}

/**
 * Position of a queued car in a specific sub-lane.
 * `stackIndex` = 0 is the front-of-queue slot — positioned so the front
 * car's front bumper clears the crosswalk (cars should stop *before* the
 * crosswalk, not on it). The queue-shift visual delay (see
 * Lanes.lastReleaseAtMs) prevents the new front car from overlapping the
 * just-released car.
 *
 * Geometry (for N approach):
 *   stop line      y = 300
 *   crosswalk      y = [278, 296]
 *   front-car back       ←  CAR_LENGTH  →  front
 *   slot[0] chosen so car-front-edge is a few px north of the crosswalk.
 */
export function queuedCarPositionInSubLane(
  approach: Approach,
  kind: LaneKind,
  subLaneIndex: number,
  stackIndex: number,
): Vec {
  const center = subLaneCenterAtStopLine(approach, kind, subLaneIndex);
  const travel = TRAVEL_DIRS[approach];
  // Crosswalk depth (18) + crosswalk-to-stop-line offset (4) + small gap (4) = 26.
  const CROSSWALK_CLEARANCE = 26;
  const dist = CAR_LENGTH / 2 + CROSSWALK_CLEARANCE + stackIndex * (CAR_LENGTH + CAR_GAP);
  return {
    x: center.x - travel.x * dist,
    y: center.y - travel.y * dist,
  };
}

// ── Path geometry for cars traversing the intersection ──────────────────────

/**
 * A car's motion through the intersection is split into two phases:
 *   1. a *cubic* Bezier that handles the maneuver through the intersection
 *      (entry tangent and exit tangent are honored — this is what guarantees
 *      a left-turner enters heading south and exits heading east);
 *   2. a linear continuation from the bezier endpoint to off-screen, so the
 *      car drives all the way to the viewport edge.
 *
 * Splitting like this is what keeps the arc tight — a single bezier from
 * stop line to off-screen would stretch the curvature across the whole path
 * and dump turning cars into oncoming lanes.
 */
export interface CarPath {
  bezier: { p0: Vec; p1: Vec; p2: Vec; p3: Vec };
  finalExit: Vec;
  /** Fraction of total transit time spent on the bezier (rest is linear). */
  bezierTimeFraction: number;
}

/** Travel direction *after* the maneuver. */
function postTurnDir(approach: Approach, kind: LaneKind): Vec {
  const t = TRAVEL_DIRS[approach];
  if (kind === 'STRAIGHT') return t;
  // In y-down canvas: physical-LEFT = (y, -x); physical-RIGHT = (-y, x).
  if (kind === 'LEFT') return { x: t.y, y: -t.x };
  return { x: -t.y, y: t.x };
}

/** Endpoint of the bezier portion: in the destination lane, just past the far stop line. */
function bezierEndpointFor(approach: Approach, kind: LaneKind, subLaneIndex: number): Vec {
  const exitSide = exitSideFor(approach, kind);
  const exitIdx = outboundLaneIndex(kind, subLaneIndex);
  const offset = (exitIdx + 0.5) * LANE_WIDTH;
  const past = 24; // just past the far stop line
  switch (exitSide) {
    case 'N': return { x: CENTER + offset, y: STOP_LINES.N - past };
    case 'S': return { x: CENTER - offset, y: STOP_LINES.S + past };
    case 'E': return { x: STOP_LINES.E + past, y: CENTER + offset };
    case 'W': return { x: STOP_LINES.W - past, y: CENTER - offset };
  }
}

export function pathFor(approach: Approach, kind: LaneKind, subLaneIndex: number): CarPath {
  // Bezier starts at slot[0] (where the front-queued car was sitting). On
  // release, the car's first frame matches its prior position — no teleport.
  // Visual queue-shift delay (in the renderer + Lanes) prevents the *next*
  // car-in-line from snapping onto slot[0] before the released car has
  // physically moved out of the way.
  const entry = queuedCarPositionInSubLane(approach, kind, subLaneIndex, 0);
  const bezierEnd = bezierEndpointFor(approach, kind, subLaneIndex);
  const finalExit = exitPointFor(approach, kind, subLaneIndex);

  const tIn = TRAVEL_DIRS[approach];
  const tOut = postTurnDir(approach, kind);

  let p1: Vec, p2: Vec;

  if (kind === 'LEFT') {
    // LEFT-turn arc through the *destination quadrant* of the intersection.
    // Placing the cubic's control points along the destination axes (rather
    // than extending entry/exit tangents) keeps the curve from cutting through
    // the wrong quadrant — i.e., into oncoming traffic. This is the "pass
    // left-to-left" convention for opposing protected lefts: each car bows
    // into its own destination quadrant and the two paths stay disjoint.
    //
    //   N→E (dest=SE): p1=(C+W, C),  p2=(C, C+W)
    //   S→W (dest=NW): p1=(C-W, C),  p2=(C, C-W)
    //   E→S (dest=SW): p1=(C, C+W),  p2=(C-W, C)
    //   W→N (dest=NE): p1=(C, C-W),  p2=(C+W, C)
    p1 = { x: CENTER + tOut.x * LANE_WIDTH, y: CENTER + tOut.y * LANE_WIDTH };
    p2 = { x: CENTER + tIn.x  * LANE_WIDTH, y: CENTER + tIn.y  * LANE_WIDTH };
  } else {
    // STRAIGHT and RIGHT: simple tangent extensions.
    //   STRAIGHT — magnitude doesn't affect shape (same dir at both ends → straight line)
    //   RIGHT    — must be SMALL relative to the entry→exit distance, otherwise
    //             p2 lands past the destination and yanks the tangent backward,
    //             producing a visible loop/spin in the rotation. Right turns are
    //             tight (~38px from entry to exit here), so we scale d to that.
    const d =
      kind === 'STRAIGHT'
        ? HALF_INTERSECTION
        : Math.hypot(bezierEnd.x - entry.x, bezierEnd.y - entry.y) * 0.55;
    p1 = { x: entry.x + tIn.x  * d, y: entry.y + tIn.y  * d };
    p2 = { x: bezierEnd.x - tOut.x * d, y: bezierEnd.y - tOut.y * d };
  }

  // Fraction of t spent on the bezier portion. Tuned so apparent speed during
  // the maneuver is close to apparent speed during the straight continuation.
  const bezierTimeFraction =
    kind === 'STRAIGHT' ? 0.40
    : kind === 'LEFT'   ? 0.55
    : 0.30;

  return {
    bezier: { p0: entry, p1, p2, p3: bezierEnd },
    finalExit,
    bezierTimeFraction,
  };
}

function cubicBezierPos(b: CarPath['bezier'], t: number): Vec {
  const u = 1 - t;
  const u2 = u * u, u3 = u2 * u;
  const t2 = t * t, t3 = t2 * t;
  return {
    x: u3 * b.p0.x + 3 * u2 * t * b.p1.x + 3 * u * t2 * b.p2.x + t3 * b.p3.x,
    y: u3 * b.p0.y + 3 * u2 * t * b.p1.y + 3 * u * t2 * b.p2.y + t3 * b.p3.y,
  };
}

function cubicBezierTangent(b: CarPath['bezier'], t: number): Vec {
  const u = 1 - t;
  return {
    x: 3 * u * u * (b.p1.x - b.p0.x) + 6 * u * t * (b.p2.x - b.p1.x) + 3 * t * t * (b.p3.x - b.p2.x),
    y: 3 * u * u * (b.p1.y - b.p0.y) + 6 * u * t * (b.p2.y - b.p1.y) + 3 * t * t * (b.p3.y - b.p2.y),
  };
}

/**
 * Ease-in-out cubic. Maps t ∈ [0, 1] to a smooth S-curve so cars accelerate
 * from rest at the stop line, peak speed in the middle of the path, and
 * decelerate at the end (invisible — happens off-screen). Total transit
 * time is unchanged; only instantaneous speed varies along the path.
 */
function easeInOutCubic(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Position + tangent for a car at `t ∈ [0, 1]` along its full path. */
export function carMotionAlong(path: CarPath, t: number): { pos: Vec; tangent: Vec } {
  const e = easeInOutCubic(t);
  if (e <= path.bezierTimeFraction) {
    const u = path.bezierTimeFraction === 0 ? 0 : e / path.bezierTimeFraction;
    return {
      pos: cubicBezierPos(path.bezier, u),
      tangent: cubicBezierTangent(path.bezier, u),
    };
  }
  const u = (e - path.bezierTimeFraction) / (1 - path.bezierTimeFraction);
  const start = path.bezier.p3;
  const dx = path.finalExit.x - start.x;
  const dy = path.finalExit.y - start.y;
  const len = Math.hypot(dx, dy) || 1;
  return {
    pos: { x: start.x + dx * u, y: start.y + dy * u },
    tangent: { x: dx / len, y: dy / len },
  };
}

/**
 * Which side of the intersection the car exits on, given (approach, kind):
 *   STRAIGHT → opposite approach
 *   LEFT     → 90° CCW (in canvas y-down): N→E, E→S, S→W, W→N
 *   RIGHT    → 90° CW:                     N→W, W→S, S→E, E→N
 */
function exitSideFor(approach: Approach, kind: LaneKind): Approach {
  if (kind === 'STRAIGHT') {
    return ({ N: 'S', S: 'N', E: 'W', W: 'E' } as const)[approach];
  }
  if (kind === 'LEFT') {
    return ({ N: 'E', E: 'S', S: 'W', W: 'N' } as const)[approach];
  }
  return ({ N: 'W', W: 'S', S: 'E', E: 'N' } as const)[approach];
}

/**
 * Outbound physical lane index a car ends up in after the maneuver:
 *   STRAIGHT  → continues in same lane (sub-lane mapped through the index table)
 *   LEFT      → innermost outbound lane (closest to centerline of destination road)
 *   RIGHT     → outermost outbound lane (curbside of destination road)
 */
function outboundLaneIndex(kind: LaneKind, subLaneIndex: number): number {
  if (kind === 'STRAIGHT') {
    const idxs = laneIndicesForKind('STRAIGHT');
    return idxs[subLaneIndex] ?? idxs[0]!;
  }
  return kind === 'LEFT' ? 0 : 3;
}

/**
 * Center of an *outbound* lane on a given exit side, projected far enough off-screen
 * that a car following the path drives completely out of the visible viewport.
 *
 * The lateral offset from the centerline is determined by the standard right-hand
 * traffic convention: outbound lanes occupy the half of the road on the *driver's
 * right* relative to the outbound travel direction.
 */
function outboundExitPoint(exitSide: Approach, indexFromCenter: number): Vec {
  const offset = (indexFromCenter + 0.5) * LANE_WIDTH;
  // Distance well past the canvas edge so cars drive off-screen.
  const past = CAR_LENGTH * 2;
  switch (exitSide) {
    case 'N': return { x: CENTER + offset, y: -past };                // N-bound: east half
    case 'S': return { x: CENTER - offset, y: CANVAS + past };        // S-bound: west half
    case 'E': return { x: CANVAS + past, y: CENTER + offset };        // E-bound: south half
    case 'W': return { x: -past,          y: CENTER - offset };       // W-bound: north half
  }
}

function exitPointFor(approach: Approach, kind: LaneKind, subLaneIndex: number): Vec {
  return outboundExitPoint(exitSideFor(approach, kind), outboundLaneIndex(kind, subLaneIndex));
}

/**
 * Control point for the quadratic bezier.
 * For STRAIGHT, midpoint (linear). For turns, the corner where the in-lane and
 * out-lane axes meet — this gives a smooth arc that hugs the proper turn radius.
 */
function controlPointFor(approach: Approach, kind: LaneKind, entry: Vec, exit: Vec): Vec {
  if (kind === 'STRAIGHT') {
    return { x: (entry.x + exit.x) / 2, y: (entry.y + exit.y) / 2 };
  }
  if (approach === 'N' || approach === 'S') {
    // Entry varies in x along its stop line; exit varies in y along its outbound axis.
    return { x: entry.x, y: exit.y };
  }
  return { x: exit.x, y: entry.y };
}


/**
 * Unit vector pointing *opposite to travel direction* for an approach —
 * i.e., the direction cars come from. Used to position a car's spawn point
 * behind its queue slot during the slide-in animation.
 */
export function approachBackDirection(approach: Approach): Vec {
  switch (approach) {
    case 'N': return { x: 0, y: -1 };  // cars come from the north
    case 'S': return { x: 0, y: 1 };
    case 'E': return { x: 1, y: 0 };
    case 'W': return { x: -1, y: 0 };
  }
}

/** Rotation (radians) for a car traveling along this approach. */
export function carRotation(approach: Approach): number {
  // Long axis of the car aligns with travel direction.
  switch (approach) {
    case 'N': return Math.PI / 2;   // pointing south (down)
    case 'S': return -Math.PI / 2;  // pointing north (up)
    case 'E': return Math.PI;       // pointing west (left)
    case 'W': return 0;             // pointing east (right)
  }
}

/** Color used to render a car based on its approach (for legibility). */
export function carColorFor(_approach: Approach): string {
  // Use a single palette per-approach helps the eye track flow.
  // Picked muted, slightly desaturated colors that read on dark asphalt.
  switch (_approach) {
    case 'N': return '#f7c873';
    case 'S': return '#7fb3ff';
    case 'E': return '#9ee493';
    case 'W': return '#e98aa8';
  }
}

export interface MovementId {
  approach: Approach;
  kind: LaneKind;
}

export function movementToId(m: Movement): MovementId {
  const [a, k] = m.split('-') as [Approach, LaneKind];
  return { approach: a, kind: k };
}
