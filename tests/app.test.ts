import { describe, it, expect } from 'vitest';
import { clampFrameDtMs } from '../src/app';
import { World } from '../src/sim/intersection';

/**
 * Regression tests for the RAF frame-loop dt clamp in src/app.ts.
 *
 * History: a raw `now - last` was fed straight into world.tick(), and RAF's
 * `now` can come in slightly *before* the `performance.now()` captured just
 * before scheduling. The resulting negative dt tripped the controller's
 * `dtMs < 0` guard, RAF never rescheduled, and the canvas froze on first
 * load. The clamp below is what keeps that from recurring.
 */
describe('clampFrameDtMs', () => {
  it('pins small negative RAF-vsync drift to zero', () => {
    expect(clampFrameDtMs(-0.8)).toBe(0);
    expect(clampFrameDtMs(-0.0001)).toBe(0);
  });

  it('caps long pauses at 100ms so tab-backgrounding does not fast-forward the sim', () => {
    expect(clampFrameDtMs(5000)).toBe(100);
    expect(clampFrameDtMs(100.0001)).toBe(100);
  });

  it('passes typical frame deltas through unchanged', () => {
    expect(clampFrameDtMs(0)).toBe(0);
    expect(clampFrameDtMs(16.6)).toBe(16.6);
    expect(clampFrameDtMs(100)).toBe(100);
  });

  it('produces a dt that the World.tick contract accepts, even at the boundaries', () => {
    const w = new World({ seed: 1 });
    // The clamp must yield something tick() will not throw on, for any raw input.
    for (const raw of [-10, -0.8, 0, 0.001, 16.6, 99.9, 100, 250, 10_000]) {
      expect(() => w.tick(clampFrameDtMs(raw))).not.toThrow();
    }
  });
});
