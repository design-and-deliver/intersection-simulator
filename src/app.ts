import { World } from './sim/intersection';
import { hitTestPedButton, render } from './render/canvas';
import { mountHud } from './render/hud';

export function startApp(canvas: HTMLCanvasElement, hudRoot: HTMLElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D context not available');

  // Arrival rates tuned to three goals: (1) queues form so the demo has
  // something to show, (2) queues don't grow off-screen, and (3) opposing
  // STRAIGHT rates are low enough that the permissive-left Poisson
  // lookahead occasionally allows a permissive turn (needs opposing rate
  // below ~4.7/min for a 50% gap-acceptance driver and ~8.9s LEFT transit).
  const world = new World({
    seed: Math.floor(Math.random() * 0xffffffff),
    arrivalRates: {
      'N-STRAIGHT': 4,
      'S-STRAIGHT': 4,
      'E-STRAIGHT': 4,
      'W-STRAIGHT': 4,
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
