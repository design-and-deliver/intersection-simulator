import type { World } from '../sim/intersection';
import { APPROACHES, type Approach } from '../sim/types';

export interface HudHandlers {
  onPedRequest?: (crosswalk: Approach) => void;
}

export function mountHud(root: HTMLElement, handlers: HudHandlers = {}): (world: World) => void {
  root.innerHTML = `
    <div>
      <h1>Intersection</h1>
    </div>
    <div class="phase-card">
      <div class="phase-name" id="phase-name">—</div>
      <div class="phase-mode" id="phase-mode">—</div>
      <div class="timer-bar"><div class="timer-fill" id="timer-fill" style="width: 0%"></div></div>
    </div>
    <div>
      <h1>Queues</h1>
      <div class="queues" id="queues"></div>
    </div>
    <div>
      <h1>Pedestrian</h1>
      <div id="ped-status" style="font-size: 11px; color: var(--muted); line-height: 1.6;">Click a round button at any corner of the intersection to request a walk.</div>
    </div>
    <div class="footer">
      Concurrent ped phasing: N/S crosswalks serve during EW-through, E/W
      crosswalks serve during NS-through. Protected lefts keep all walks
      off — turning vehicles would conflict.
    </div>
  `;

  const queueEls: Record<string, HTMLElement> = {};
  const queuesRoot = root.querySelector<HTMLElement>('#queues')!;
  for (const a of APPROACHES) {
    const cell = document.createElement('div');
    cell.className = 'queue-cell';
    cell.innerHTML = `
      <div class="label">${a} approach</div>
      <div class="row"><span>L</span><span data-q="${a}-LEFT">0</span></div>
      <div class="row"><span>S</span><span data-q="${a}-STRAIGHT">0</span></div>
      <div class="row"><span>R</span><span data-q="${a}-RIGHT">0</span></div>
    `;
    queuesRoot.appendChild(cell);
    cell.querySelectorAll<HTMLElement>('[data-q]').forEach((el) => {
      queueEls[el.dataset['q']!] = el;
    });
  }

  const phaseNameEl = root.querySelector<HTMLElement>('#phase-name')!;
  const phaseModeEl = root.querySelector<HTMLElement>('#phase-mode')!;
  const timerFillEl = root.querySelector<HTMLElement>('#timer-fill')!;
  const pedStatusEl = root.querySelector<HTMLElement>('#ped-status')!;

  return function update(world: World) {
    const snap = world.snapshot();
    phaseNameEl.textContent = `Phase ${snap.controller.phase.id} · ${snap.controller.phase.label}`;
    phaseModeEl.textContent = snap.controller.mode;
    const pct = (snap.controller.modeElapsedMs / snap.controller.modeDurationMs) * 100;
    timerFillEl.style.width = `${Math.min(100, pct).toFixed(1)}%`;
    for (const [m, len] of Object.entries(snap.queues)) {
      const el = queueEls[m];
      if (el) el.textContent = String(len);
    }
    // Compact status summary of each crosswalk's current walk state.
    const statusLines: string[] = [];
    for (const cw of APPROACHES) {
      const walk = snap.controller.walkSignalFor(cw);
      const pending = snap.controller.pedRequestPendingFor(cw);
      if (walk !== 'DONT_WALK') statusLines.push(`${cw}: ${walk.replace(/_/g, ' ')}`);
      else if (pending) statusLines.push(`${cw}: queued`);
    }
    pedStatusEl.textContent = statusLines.length
      ? statusLines.join(' · ')
      : 'Click a round button at any corner of the intersection to request a walk.';
  };
}
