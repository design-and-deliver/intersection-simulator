import type { ControllerSnapshot } from '../sim/controller';
import type { Lanes } from '../sim/cars';
import { APPROACH_MS, TRANSIT_MS, VISUAL_QUEUE_SHIFT_DELAY_MS } from '../sim/cars';
import {
  APPROACHES,
  LANE_KINDS,
  parseMovement,
  type Approach,
  type LaneKind,
  type Movement,
  type SignalColor,
  type LeftSignalColor,
} from '../sim/types';
import {
  CANVAS,
  CENTER,
  HALF_INTERSECTION,
  HALF_ROAD,
  LANE_WIDTH,
  STOP_LINES,
  approachBackDirection,
  carColorFor,
  carMotionAlong,
  carRotation,
  pathFor,
  queuedCarPositionInSubLane,
  signalHeadPosition,
  signalHousingRotation,
  signalPolePosition,
  subLaneCount,
  CAR_LENGTH,
  CAR_WIDTH,
} from './geometry';

/** How far back from the queue slot a car spawns for its slide-in animation. */
const APPROACH_DISTANCE = 160;

const COLORS = {
  asphalt: '#1a1f26',
  curb: '#0a0d11',
  laneLine: '#3a4250',
  laneLineDash: [10, 14] as [number, number],
  centerline: '#c9a227',
  crosswalk: '#d8dde6',
  signalHousing: '#d4a017', // gold/amber, like real US traffic-light housings
  signalRing: '#0a0d11',
  light: {
    RED: '#ff4d4d',
    YELLOW: '#ffcc33',
    GREEN: '#3ad27e',
    OFF: '#22272e',
    FLASHING_ORANGE: '#ff9933',
  },
} as const;

export interface RenderInput {
  controller: ControllerSnapshot;
  lanes: Lanes;
  /** Sim time in ms — used for blinking effects (flashing orange). */
  timeMs: number;
}

export function render(ctx: CanvasRenderingContext2D, input: RenderInput): void {
  ctx.clearRect(0, 0, CANVAS, CANVAS);
  drawAsphaltAndLanes(ctx);
  drawCrosswalks(ctx);
  drawQueuedCars(ctx, input.lanes, input.timeMs);
  drawInFlightCars(ctx, input.lanes, input.timeMs);
  drawSignals(ctx, input.controller, input.timeMs);
  drawPedButtons(ctx, input.controller, input.timeMs);
}

function drawAsphaltAndLanes(ctx: CanvasRenderingContext2D): void {
  // Background grass.
  ctx.fillStyle = '#11181f';
  ctx.fillRect(0, 0, CANVAS, CANVAS);

  // Roads.
  ctx.fillStyle = COLORS.asphalt;
  // N-S road
  ctx.fillRect(CENTER - HALF_ROAD, 0, HALF_ROAD * 2, CANVAS);
  // E-W road
  ctx.fillRect(0, CENTER - HALF_ROAD, CANVAS, HALF_ROAD * 2);

  // Lane markings.
  ctx.strokeStyle = COLORS.laneLine;
  ctx.lineWidth = 2;
  ctx.setLineDash(COLORS.laneLineDash);

  // N-S lane lines (excluding the centerline and the road edges; only the in-direction lane separators)
  // For each side of the centerline, draw 3 dashed lines between lanes (between lanes 1-2, 2-3, 3-4).
  for (let i = 1; i < 4; i++) {
    const offsetW = CENTER - i * LANE_WIDTH; // west half lines
    const offsetE = CENTER + i * LANE_WIDTH; // east half lines
    drawDashedSegment(ctx, offsetW, 0, offsetW, STOP_LINES.N);
    drawDashedSegment(ctx, offsetW, STOP_LINES.S, offsetW, CANVAS);
    drawDashedSegment(ctx, offsetE, 0, offsetE, STOP_LINES.N);
    drawDashedSegment(ctx, offsetE, STOP_LINES.S, offsetE, CANVAS);
  }
  for (let i = 1; i < 4; i++) {
    const offsetN = CENTER - i * LANE_WIDTH;
    const offsetS = CENTER + i * LANE_WIDTH;
    drawDashedSegment(ctx, 0, offsetN, STOP_LINES.W, offsetN);
    drawDashedSegment(ctx, STOP_LINES.E, offsetN, CANVAS, offsetN);
    drawDashedSegment(ctx, 0, offsetS, STOP_LINES.W, offsetS);
    drawDashedSegment(ctx, STOP_LINES.E, offsetS, CANVAS, offsetS);
  }

  // Centerlines (solid yellow).
  ctx.setLineDash([]);
  ctx.strokeStyle = COLORS.centerline;
  ctx.lineWidth = 1.5;
  // Double yellow centerlines, drawn as two parallel lines.
  for (const off of [-2, 2]) {
    line(ctx, CENTER + off, 0, CENTER + off, STOP_LINES.N);
    line(ctx, CENTER + off, STOP_LINES.S, CENTER + off, CANVAS);
    line(ctx, 0, CENTER + off, STOP_LINES.W, CENTER + off);
    line(ctx, STOP_LINES.E, CENTER + off, CANVAS, CENTER + off);
  }

  // Stop lines (white, solid).
  ctx.setLineDash([]);
  ctx.strokeStyle = '#dde2eb';
  ctx.lineWidth = 4;
  // N approach stop line: at y=STOP_LINES.N, across west half (the southbound lanes)
  line(ctx, CENTER - HALF_ROAD, STOP_LINES.N, CENTER, STOP_LINES.N);
  // S approach stop line: across east half
  line(ctx, CENTER, STOP_LINES.S, CENTER + HALF_ROAD, STOP_LINES.S);
  // E approach stop line: across north half
  line(ctx, STOP_LINES.E, CENTER - HALF_ROAD, STOP_LINES.E, CENTER);
  // W approach stop line: across south half
  line(ctx, STOP_LINES.W, CENTER, STOP_LINES.W, CENTER + HALF_ROAD);
}

function drawDashedSegment(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawCrosswalks(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = COLORS.crosswalk;
  const stripeW = 6;
  const stripeGap = 4;
  const cwDepth = 18; // depth of crosswalk strip
  // North crosswalk: just outside the intersection on the N side, spanning the full road
  drawCrosswalkStrip(ctx, CENTER - HALF_ROAD, STOP_LINES.N - cwDepth - 4, ROAD_WIDTH(), cwDepth, 'horizontal', stripeW, stripeGap);
  drawCrosswalkStrip(ctx, CENTER - HALF_ROAD, STOP_LINES.S + 4, ROAD_WIDTH(), cwDepth, 'horizontal', stripeW, stripeGap);
  drawCrosswalkStrip(ctx, STOP_LINES.E + 4, CENTER - HALF_ROAD, cwDepth, ROAD_WIDTH(), 'vertical', stripeW, stripeGap);
  drawCrosswalkStrip(ctx, STOP_LINES.W - cwDepth - 4, CENTER - HALF_ROAD, cwDepth, ROAD_WIDTH(), 'vertical', stripeW, stripeGap);
}

function ROAD_WIDTH(): number { return HALF_ROAD * 2; }

function drawCrosswalkStrip(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number,
  axis: 'horizontal' | 'vertical',
  stripeW: number, gap: number,
): void {
  const len = axis === 'horizontal' ? w : h;
  const step = stripeW + gap;
  for (let p = 0; p + stripeW <= len; p += step) {
    if (axis === 'horizontal') ctx.fillRect(x + p, y, stripeW, h);
    else ctx.fillRect(x, y + p, w, stripeW);
  }
}

function drawQueuedCars(ctx: CanvasRenderingContext2D, lanes: Lanes, nowMs: number): void {
  for (const a of APPROACHES) {
    for (const k of LANE_KINDS) {
      const movement = `${a}-${k}` as Movement;
      const queue = lanes.queue(movement);
      const rot = carRotation(a);
      const color = carColorFor(a);
      const numSubLanes = subLaneCount(k);
      const backDir = approachBackDirection(a);
      // Per-sub-lane visual offset: when a car was just released on this
      // sub-lane, cars behind keep their old slot positions for the delay
      // matching that lane kind's headway (LEFT > STRAIGHT because lefts
      // clear slower). Prevents visual rear-end of the just-released car.
      const delay = VISUAL_QUEUE_SHIFT_DELAY_MS[k];
      const offsetPerSubLane = new Array(numSubLanes).fill(0);
      for (let sub = 0; sub < numSubLanes; sub++) {
        const lastRelease = lanes.lastReleaseAtMs(movement, sub);
        if (lastRelease !== null && nowMs - lastRelease < delay) {
          offsetPerSubLane[sub] = 1;
        }
      }
      const stackPerSubLane = new Array(numSubLanes).fill(0);
      for (const car of queue) {
        const sub = Math.min(car.subLaneIndex, numSubLanes - 1);
        const stack = stackPerSubLane[sub]++ + offsetPerSubLane[sub];
        const slot = queuedCarPositionInSubLane(a, k, sub, stack);

        // Slide-in animation: cars approach from APPROACH_DISTANCE back along
        // the road and decelerate into their queue slot. Ease-out cubic so the
        // car coasts to a stop instead of skidding to a halt at constant speed.
        const elapsed = nowMs - car.arrivedAtMs;
        let px: number, py: number;
        if (elapsed < APPROACH_MS) {
          const t = Math.max(0, elapsed / APPROACH_MS);
          const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic = decelerating
          const spawnX = slot.x + backDir.x * APPROACH_DISTANCE;
          const spawnY = slot.y + backDir.y * APPROACH_DISTANCE;
          px = spawnX + (slot.x - spawnX) * eased;
          py = spawnY + (slot.y - spawnY) * eased;
        } else {
          px = slot.x;
          py = slot.y;
        }

        // Cull if offscreen.
        if (px < -CAR_LENGTH || px > CANVAS + CAR_LENGTH ||
            py < -CAR_LENGTH || py > CANVAS + CAR_LENGTH) {
          continue;
        }
        drawCar(ctx, px, py, rot, color);
      }
    }
  }
}

function drawInFlightCars(ctx: CanvasRenderingContext2D, lanes: Lanes, nowMs: number): void {
  for (const car of lanes.inFlight) {
    const released = car.releasedAtMs;
    if (released == null) continue;
    const { approach, kind } = parseMovement(car.lane);
    const path = pathFor(approach, kind, car.subLaneIndex);
    const t = Math.max(0, Math.min(1, (nowMs - released) / TRANSIT_MS[kind]));
    const { pos, tangent } = carMotionAlong(path, t);
    const rot = Math.atan2(tangent.y, tangent.x);
    drawCar(ctx, pos.x, pos.y, rot, carColorFor(approach));
  }
}

function drawCar(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number, rot: number, color: string,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  // Body
  roundRect(ctx, -CAR_LENGTH / 2, -CAR_WIDTH / 2, CAR_LENGTH, CAR_WIDTH, 3);
  ctx.fillStyle = color;
  ctx.fill();
  // Windshield hint
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(CAR_LENGTH * 0.05, -CAR_WIDTH / 2 + 2, CAR_LENGTH * 0.3, CAR_WIDTH - 4);
  ctx.restore();
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawSignals(
  ctx: CanvasRenderingContext2D,
  snap: ControllerSnapshot,
  timeMs: number,
): void {
  // Draw pole + arm first so signal heads sit on top of the gantry graphics.
  for (const a of APPROACHES) drawSignalGantry(ctx, a);
  for (const a of APPROACHES) {
    const throughMv = `${a}-STRAIGHT` as Movement;
    const leftMv = `${a}-LEFT` as Movement;
    const throughColor = snap.signalFor(throughMv);
    const leftColor: LeftSignalColor = snap.leftSignalFor(leftMv);
    drawSignalHead(ctx, a, 'STRAIGHT', throughColor, timeMs);
    drawLeftSignalHead(ctx, a, leftColor, timeMs);
  }
}

/**
 * Draw the gantry: pole at the corner, then an L-shape (stub + arm)
 * reaching across the road to whichever signal head is farther from the
 * pole. The closer head hangs from the arm en route to the far one.
 *
 * Arm orientation depends on which road the approach uses:
 *   - N/S approaches: arm runs east–west (perpendicular to the N–S road)
 *   - E/W approaches: arm runs north–south (perpendicular to the E–W road)
 */
function drawSignalGantry(ctx: CanvasRenderingContext2D, approach: Approach): void {
  const pole = signalPolePosition(approach);
  const through = signalHeadPosition(approach, 'STRAIGHT');
  const left = signalHeadPosition(approach, 'LEFT');
  const armRunsHorizontal = approach === 'N' || approach === 'S';

  ctx.save();
  ctx.strokeStyle = '#3a4250';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  if (armRunsHorizontal) {
    const armY = through.y;
    const farX = Math.abs(through.x - pole.x) > Math.abs(left.x - pole.x) ? through.x : left.x;
    // Vertical stub from pole to the arm row.
    ctx.beginPath(); ctx.moveTo(pole.x, pole.y); ctx.lineTo(pole.x, armY); ctx.stroke();
    // Horizontal arm reaching past both heads to the far one.
    ctx.beginPath(); ctx.moveTo(pole.x, armY); ctx.lineTo(farX, armY); ctx.stroke();
  } else {
    const armX = through.x;
    const farY = Math.abs(through.y - pole.y) > Math.abs(left.y - pole.y) ? through.y : left.y;
    // Horizontal stub from pole to the arm column.
    ctx.beginPath(); ctx.moveTo(pole.x, pole.y); ctx.lineTo(armX, pole.y); ctx.stroke();
    // Vertical arm reaching past both heads to the far one.
    ctx.beginPath(); ctx.moveTo(armX, pole.y); ctx.lineTo(armX, farY); ctx.stroke();
  }

  // Pole base disc at the corner.
  ctx.fillStyle = '#0a0d11';
  ctx.beginPath();
  ctx.arc(pole.x, pole.y, 3.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#3a4250';
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

/**
 * Shared signal-head renderer. Orientation matches the road axis:
 *   - 'horizontal' → lights left-to-right (used for E/W approaches, on the horizontal road)
 *   - 'vertical'   → lights top-to-bottom (used for N/S approaches, on the vertical road)
 *
 * `flipped` reverses the light order — used so each fixture reads
 * "right-side-up" relative to its approach driver.
 */
function drawSignal(
  ctx: CanvasRenderingContext2D,
  pos: { x: number; y: number },
  colors: readonly (SignalColor | LeftSignalColor)[],
  active: SignalColor | LeftSignalColor,
  orientation: 'horizontal' | 'vertical',
  flipped: boolean,
  nowMs: number,
  opts: { r: number; padding: number; label?: string },
): void {
  const { r, padding, label } = opts;
  // Flashing-orange blinks at ~2Hz: every 250ms it toggles.
  const flashOff = active === 'FLASHING_ORANGE' && Math.floor(nowMs / 250) % 2 === 1;
  const lightStep = r * 2 + padding;
  const n = colors.length;
  const longSide = padding * 2 + n * (r * 2) + (n - 1) * padding;
  const shortSide = padding * 2 + r * 2;
  const hWidth  = orientation === 'horizontal' ? longSide  : shortSide;
  const hHeight = orientation === 'horizontal' ? shortSide : longSide;

  ctx.save();
  ctx.translate(pos.x, pos.y);

  // Housing
  ctx.fillStyle = COLORS.signalHousing;
  roundRect(ctx, -hWidth / 2, -hHeight / 2, hWidth, hHeight, 4);
  ctx.fill();

  // Lights — left-to-right (horizontal) or top-to-bottom (vertical), reversed if flipped.
  const order = flipped ? [...colors].reverse() : colors;
  order.forEach((c, i) => {
    const lit = !flashOff && active === c;
    let xx = 0, yy = 0;
    if (orientation === 'horizontal') {
      const cx0 = -hWidth / 2 + padding + r;
      xx = cx0 + i * lightStep;
    } else {
      const cy0 = -hHeight / 2 + padding + r;
      yy = cy0 + i * lightStep;
    }
    ctx.beginPath();
    ctx.arc(xx, yy, r, 0, Math.PI * 2);
    ctx.fillStyle = lit ? COLORS.light[c] : COLORS.light.OFF;
    ctx.fill();
    ctx.strokeStyle = COLORS.signalRing;
    ctx.lineWidth = 1;
    ctx.stroke();
    if (lit) {
      ctx.beginPath();
      ctx.arc(xx, yy, r + 2, 0, Math.PI * 2);
      ctx.strokeStyle = withAlpha(COLORS.light[c], 0.35);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });

  // Label above the housing (always upright on screen).
  if (label) {
    ctx.fillStyle = '#7d8896';
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 0, -hHeight / 2 - 7);
  }
  ctx.restore();
}

function signalOrientation(approach: Approach): 'horizontal' | 'vertical' {
  return approach === 'E' || approach === 'W' ? 'horizontal' : 'vertical';
}

/**
 * Whether the signal's light order should be reversed so it reads
 * right-side-up from the approaching driver's POV. The convention here:
 * RED appears on the side *furthest* from the driver (canvas-ahead).
 *   N (driver from N → ahead is +y): R at higher y → flip
 *   S (driver from S → ahead is -y): R at lower y → no flip
 *   E (driver from E → ahead is -x): R at lower x → no flip
 *   W (driver from W → ahead is +x): R at higher x → flip
 */
function signalIsFlipped(approach: Approach): boolean {
  return approach === 'N' || approach === 'W';
}

function drawSignalHead(
  ctx: CanvasRenderingContext2D,
  approach: Approach,
  _kind: LaneKind,
  color: SignalColor,
  nowMs: number,
): void {
  const pos = signalHeadPosition(approach, 'STRAIGHT');
  drawSignal(
    ctx, pos,
    ['RED', 'YELLOW', 'GREEN'] as const,
    color,
    signalOrientation(approach),
    signalIsFlipped(approach),
    nowMs,
    { r: 5, padding: 3 },
  );
}

function drawLeftSignalHead(
  ctx: CanvasRenderingContext2D,
  approach: Approach,
  color: LeftSignalColor,
  nowMs: number,
): void {
  const pos = signalHeadPosition(approach, 'LEFT');
  drawSignal(
    ctx, pos,
    ['RED', 'YELLOW', 'FLASHING_ORANGE', 'GREEN'] as const,
    color,
    signalOrientation(approach),
    signalIsFlipped(approach),
    nowMs,
    { r: 5, padding: 3, label: 'L' },
  );
}

/**
 * Round pressable crosswalk buttons — bidirectional: *two* buttons per
 * crosswalk, one at each corner end. Both buttons for a crosswalk show the
 * same walk-signal state (because real walk signs across the street are
 * always mirrored). Clicking either one queues the same request.
 *
 * At each corner, two distinct buttons appear: one for each of the two
 * adjacent crosswalks that meet at that corner. e.g. NW corner has a N
 * crosswalk button and a W crosswalk button, offset in different directions.
 */
const PED_BUTTON_RADIUS = 7;
const CROSSWALK_BUTTON_POSITIONS: Record<Approach, Array<{ x: number; y: number }>> = {
  N: [
    { x: STOP_LINES.W - 10, y: STOP_LINES.N - 25 }, // NW end (above corner)
    { x: STOP_LINES.E + 10, y: STOP_LINES.N - 25 }, // NE end
  ],
  S: [
    { x: STOP_LINES.W - 10, y: STOP_LINES.S + 25 }, // SW end
    { x: STOP_LINES.E + 10, y: STOP_LINES.S + 25 }, // SE end
  ],
  E: [
    { x: STOP_LINES.E + 25, y: STOP_LINES.N - 10 }, // NE end (right of corner)
    { x: STOP_LINES.E + 25, y: STOP_LINES.S + 10 }, // SE end
  ],
  W: [
    { x: STOP_LINES.W - 25, y: STOP_LINES.N - 10 }, // NW end
    { x: STOP_LINES.W - 25, y: STOP_LINES.S + 10 }, // SW end
  ],
};

function drawPedButtons(
  ctx: CanvasRenderingContext2D,
  snap: ControllerSnapshot,
  timeMs: number,
): void {
  for (const cw of APPROACHES) {
    const state = snap.walkSignalFor(cw);
    const pending = snap.pedRequestPendingFor(cw);
    for (const pos of CROSSWALK_BUTTON_POSITIONS[cw]) {
      drawPedButton(ctx, pos.x, pos.y, state, pending, timeMs);
    }
  }
}

function drawPedButton(
  ctx: CanvasRenderingContext2D,
  cx: number, cy: number,
  state: 'WALK' | 'FLASH_DONT_WALK' | 'DONT_WALK',
  pending: boolean,
  nowMs: number,
): void {
  const r = PED_BUTTON_RADIUS;
  const flashOn = Math.floor(nowMs / 250) % 2 === 0;

  // Color palette by state.
  let faceColor: string;
  let ringColor: string;
  let glyph: string;
  let glyphColor = '#0a0d11';
  if (state === 'WALK') {
    faceColor = '#3ad27e';
    ringColor = '#66e59a';
    glyph = '\u{1F6B6}';
  } else if (state === 'FLASH_DONT_WALK') {
    faceColor = flashOn ? '#ff9933' : '#1a1f26';
    ringColor = '#ff9933';
    glyph = '✋';
  } else if (pending) {
    faceColor = '#d4a017';
    ringColor = '#f0c040';
    glyph = '\u{1F6B6}';
  } else {
    faceColor = '#2a2f38';
    ringColor = '#4a5160';
    glyph = '\u{1F6B6}';
    glyphColor = '#7d8896';
  }

  ctx.save();
  // Housing disc behind button (darker — suggests pole/mount).
  ctx.fillStyle = '#0a0d11';
  ctx.beginPath();
  ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
  ctx.fill();
  // Button face.
  ctx.fillStyle = faceColor;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = ringColor;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Glow for active states.
  if (state === 'WALK' || (state === 'FLASH_DONT_WALK' && flashOn)) {
    ctx.beginPath();
    ctx.arc(cx, cy, r + 3.5, 0, Math.PI * 2);
    ctx.strokeStyle = withAlpha(ringColor, 0.3);
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // Ped glyph (sized to fit the smaller radius).
  ctx.fillStyle = glyphColor;
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, cx, cy + 1);
  ctx.restore();
}

/**
 * Hit-test a canvas-space coordinate against the ped buttons.
 * Returns the crosswalk ID if a button was clicked, null otherwise.
 */
export function hitTestPedButton(x: number, y: number): Approach | null {
  const hitR2 = (PED_BUTTON_RADIUS + 2) * (PED_BUTTON_RADIUS + 2);
  for (const cw of APPROACHES) {
    for (const p of CROSSWALK_BUTTON_POSITIONS[cw]) {
      const dx = x - p.x;
      const dy = y - p.y;
      if (dx * dx + dy * dy <= hitR2) return cw;
    }
  }
  return null;
}

function withAlpha(hex: string, alpha: number): string {
  // Accepts #rrggbb only.
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
