import { describe, it, expect } from 'vitest';
import { World } from '../src/sim/intersection';
import { ALL_MOVEMENTS, type Movement } from '../src/sim/types';
import {
  pathFor,
  carMotionAlong,
  signalHeadPosition,
  signalPolePosition,
  queuedCarPositionInSubLane,
  approachBackDirection,
  laneIndicesForKind,
  subLaneCount,
} from '../src/render/geometry';

/**
 * Renderer smoke tests.
 *
 * The actual canvas drawing is verified by visual iteration with screenshots.
 * These tests exercise the geometry math that drives the renderer — making
 * sure no path computation throws, no signal position lands at NaN, and the
 * lane/path structure stays internally consistent. They're a regression net,
 * not a visual-correctness oracle.
 */

describe('Render geometry — basic sanity', () => {
  it('every (approach, kind, subLane) combination yields a finite path', () => {
    for (const m of ALL_MOVEMENTS) {
      const [approach, kind] = m.split('-') as [Approach, LaneKind];
      const subLanes = subLaneCount(kind as LaneKind);
      for (let sub = 0; sub < subLanes; sub++) {
        const path = pathFor(approach as Approach, kind as LaneKind, sub);
        // Endpoints must be finite numbers.
        for (const p of [path.bezier.p0, path.bezier.p1, path.bezier.p2, path.bezier.p3, path.finalExit]) {
          expect(Number.isFinite(p.x)).toBe(true);
          expect(Number.isFinite(p.y)).toBe(true);
        }
        // Sample motion along the path and confirm finite, monotone-ish progression.
        const samples = [0, 0.25, 0.5, 0.75, 1];
        for (const t of samples) {
          const motion = carMotionAlong(path, t);
          expect(Number.isFinite(motion.pos.x)).toBe(true);
          expect(Number.isFinite(motion.pos.y)).toBe(true);
          expect(Number.isFinite(motion.tangent.x)).toBe(true);
          expect(Number.isFinite(motion.tangent.y)).toBe(true);
          // Tangent shouldn't be a zero vector (would mean undefined heading).
          expect(Math.hypot(motion.tangent.x, motion.tangent.y)).toBeGreaterThan(0);
        }
      }
    }
  });

  it('all signal head and pole positions are within (or just outside) canvas bounds', () => {
    const PADDING = 80; // signals can sit slightly outside corners
    for (const a of ['N', 'S', 'E', 'W'] as const) {
      const through = signalHeadPosition(a, 'STRAIGHT');
      const left = signalHeadPosition(a, 'LEFT');
      const pole = signalPolePosition(a);
      for (const p of [through, left, pole]) {
        expect(p.x).toBeGreaterThan(-PADDING);
        expect(p.x).toBeLessThan(800 + PADDING);
        expect(p.y).toBeGreaterThan(-PADDING);
        expect(p.y).toBeLessThan(800 + PADDING);
      }
    }
  });

  it('queue stack positions step monotonically away from stop line', () => {
    // For each (approach, kind, subLane), positions at stack indices 0..5
    // should move monotonically in the direction opposite to travel.
    for (const a of ['N', 'S', 'E', 'W'] as const) {
      for (const k of ['LEFT', 'STRAIGHT', 'RIGHT'] as const) {
        const numSubs = subLaneCount(k);
        for (let sub = 0; sub < numSubs; sub++) {
          const back = approachBackDirection(a);
          const positions = [0, 1, 2, 3, 4, 5].map((i) =>
            queuedCarPositionInSubLane(a, k, sub, i),
          );
          for (let i = 1; i < positions.length; i++) {
            const dx = positions[i]!.x - positions[i - 1]!.x;
            const dy = positions[i]!.y - positions[i - 1]!.y;
            // Step direction should align with the back direction (cars stack backward).
            const dot = dx * back.x + dy * back.y;
            expect(dot).toBeGreaterThan(0);
          }
        }
      }
    }
  });

  it('lane index tables cover all 4 physical lanes per approach exactly once', () => {
    const allIdx = ['LEFT', 'STRAIGHT', 'RIGHT'].flatMap((k) =>
      [...laneIndicesForKind(k as LaneKind)],
    );
    expect(allIdx.sort()).toEqual([0, 1, 2, 3]);
  });
});

describe('Render snapshot consistency with simulation', () => {
  it('snapshot()-then-render() does not throw across many random ticks', () => {
    // We can't actually paint without a canvas, but we can build the input
    // a renderer would consume and confirm it's well-formed at every tick.
    const w = new World({ seed: 1 });
    for (let t = 0; t < 30_000; t += 250) {
      w.tick(250);
      const snap = w.snapshot();
      expect(Number.isFinite(snap.timeMs)).toBe(true);
      expect(snap.controller.phase).toBeDefined();
      expect(['GREEN', 'YELLOW', 'ALL_RED']).toContain(snap.controller.mode);
      for (const cw of ['N', 'S', 'E', 'W'] as const) {
        expect(['WALK', 'FLASH_DONT_WALK', 'DONT_WALK']).toContain(snap.controller.walkSignalFor(cw));
      }
      // Every queue length is a non-negative integer.
      for (const m of ALL_MOVEMENTS) {
        expect(snap.queues[m]).toBeGreaterThanOrEqual(0);
        expect(Number.isInteger(snap.queues[m])).toBe(true);
      }
      // In-flight cars are valid.
      for (const car of w.lanes.inFlight) {
        expect(car.releasedAtMs).toBeDefined();
        expect(Number.isFinite(car.releasedAtMs!)).toBe(true);
      }
    }
  });
});

// Type imports inside to avoid polluting top of file with unused type-only imports
type Approach = 'N' | 'S' | 'E' | 'W';
type LaneKind = 'LEFT' | 'STRAIGHT' | 'RIGHT';
