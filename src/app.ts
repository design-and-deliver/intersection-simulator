import { World } from './sim/intersection';
import { hitTestPedButton, render } from './render/canvas';
import { mountHud } from './render/hud';

export function startApp(canvas: HTMLCanvasElement, hudRoot: HTMLElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context not available');

  // Arrival rates tuned just under steady-state service capacity, so queues
  // form (the demo has something to show) but don't grow off-screen.
  // Capacity per movement (rough): STRAIGHT ~14/min (2 sub-lanes), LEFT ~5/min,
  // RIGHT ~6/min — accounting for actuation cycle distribution.
  const world = new World({
    seed: Math.floor(Math.random() * 0xffffffff),
    arrivalRates: {
      'N-STRAIGHT': 13,
      'S-STRAIGHT': 13,
      'E-STRAIGHT': 11,
      'W-STRAIGHT': 11,
      'N-LEFT': 4,
      'S-LEFT': 4,
      'E-LEFT': 3,
      'W-LEFT': 3,
      'N-RIGHT': 4,
      'S-RIGHT': 4,
      'E-RIGHT': 3,
      'W-RIGHT': 3,
    },
  });

  const updateHud = mountHud(hudRoot, {
    onPedRequest: (crosswalk) => world.controller.requestPed(crosswalk),
  });

  // Canvas click → hit-test the corner ped buttons → enqueue walk request.
  const canvasToWorldCoords = (ev: MouseEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) * (canvas.width / rect.width),
      y: (ev.clientY - rect.top) * (canvas.height / rect.height),
    };
  };
  canvas.addEventListener('click', (ev) => {
    const { x, y } = canvasToWorldCoords(ev);
    const cw = hitTestPedButton(x, y);
    if (cw) world.controller.requestPed(cw);
  });
  // Cursor hint — pointer over a ped button, default elsewhere.
  canvas.addEventListener('mousemove', (ev) => {
    const { x, y } = canvasToWorldCoords(ev);
    canvas.style.cursor = hitTestPedButton(x, y) ? 'pointer' : 'default';
  });

  let last = performance.now();
  function frame(now: number) {
    const dtMs = Math.min(100, now - last); // clamp big pauses (tab switch)
    last = now;
    world.tick(dtMs);
    render(ctx!, { controller: world.controller.snapshot(), lanes: world.lanes, timeMs: world.timeMs });
    updateHud(world);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
