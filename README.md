# Traffic Intersection Simulator

Four-way intersection with sensor-actuated signals, protected lefts, permissive lefts, and pedestrian crossings. Pure-tick simulation, canvas renderer, 82 tests.

Built for the Droplet take-home ([INTERSECTION.md](../droplet_take_home_v2/INTERSECTION.md)).

```
       ___________
      /  ____  __ \
     / _/ __ \/_  \\         <-- ASCII car (per spec)
    |__/    \____/ |
    (_)            (_)
```

---

## Run

Node 20+, pnpm.

```bash
pnpm install
pnpm dev        # browser at http://localhost:5173
pnpm test       # 82 tests, ~1s
pnpm typecheck
```

Click any round button at an intersection corner to request a walk.

---

## Against spec

| Feature | Where |
|---|---|
| Signal changes on a timer | `controller.ts` (fixed-timer fallback) |
| Cars arrive + traverse when green | `cars.ts`: Poisson arrivals, parallel sub-lane service |
| Opposing protected lefts, straights red | Phases B & D, enforced at module load + by runtime property test |
| Smart sensor signal | `controller.setDemand()`: skip-empty + extend-while-demand + gap-out |
| Walk button "clears" intersection | Concurrent phasing (per-crosswalk, served during parallel vehicle phase — real US pattern) |
| LEFT 4th aspect (flashing orange) | Permissive-left; cars actually turn when opposing is clear *and* Poisson lookahead says arrival probability during transit < 50% (driver risk tolerance — see Design) |

---

## Design

### Pure sim, I/O at the edges

`World.tick(dtMs)` has no wall clock, DOM, or canvas. Same code path in the browser and in 82 Node tests.

```
src/sim/              # pure — no DOM
  types.ts            conflicts.ts   phases.ts
  controller.ts       cars.ts        rng.ts
  intersection.ts

src/render/           # all visual code
  geometry.ts   canvas.ts   hud.ts

src/app.ts            # RAF loop wiring sim + render
```

### Safety as a property

Two layers:

1. **Module load:** every defined phase is validated against the declarative conflict matrix. Program refuses to start with an unsafe phase.
2. **Runtime:** `invariant.test.ts` runs 5 traffic scenarios × 10 simulated minutes each, asserting green-movement pairwise-compatibility on every tick.

Conflict matrix derived from one rule function:

```
same approach              → compatible
opposite STRAIGHT+STRAIGHT → compatible
opposite LEFT+LEFT         → compatible  (protected-left phase)
opposite RIGHT+anything    → compatible
opposite LEFT+STRAIGHT     → CONFLICT
perpendicular              → CONFLICT
```

Conservative (no permissive rights in the matrix) so the property test catches unsafe phases without false positives.

### Sensor actuation

`controller.setDemand(fn)` injects per-movement demand:
- **Skip-empty** at each ALL_RED; loop safe (never infinite).
- **Extend-while-demand** up to `maxGreenMs`.
- **Gap-out** when demand drops, floored at `minGreenMs`.

Without a callback, falls back to fixed-timer — keeps the controller tests simple.

### Pedestrian phase (concurrent)

Per-crosswalk requests; walk signal serves during its *parallel* vehicle phase (N/S crosswalks during Phase C, E/W during Phase A). Protected-left phases suppress all walks.

Two integrations with actuation:
- **Ped recall** — pending walk counts as demand; serving phase won't skip.
- **Min-green floor** — raised to `pedWalkMs + pedClearanceMs` (11s) when serving, so a 4s min-green can't truncate an 11s walk cycle.

Walk timing tracks *press time*, not phase start — pressing mid-green still gets the full WALK + FLASH duration. Never preemptive.

### Permissive-left

During opposite-through phase, LEFT shows FLASHING_ORANGE. Cars release when:
1. Opposing through is snapshot-clear (empty queue, no in-flight on opposing path), **and**
2. Poisson lookahead: P(opposing arrival during turn transit) < `PERMISSIVE_LOOKAHEAD_RISK` (default 50%).

The threshold is a **gap-acceptance model** of the spec's "go if no cars are coming the other way." Traffic studies put typical US driver tolerance around 30–50%; 50% is the realistic default. 20% would model a cautious driver (rarely takes a gap); 60%+ would model an aggressive one. Tune in `intersection.ts`.

The movement is never added to `greenMovements()`, so safety invariant is untouched.

### Cars

- Per-lane Poisson, seeded PRNG.
- STRAIGHT has 2 sub-lanes, **parallel service** (both drain at once when green — a real bug fixed during build).
- Per-kind headway: STRAIGHT 1.8s, LEFT 2.5s, RIGHT 2.0s (lefts clear slower).
- Cars in intersection: cubic bezier with control points in the *destination quadrant* so left-turners arc through SE/SW/NW/NE, never crossing through the wrong side. Linear continuation off-screen.
- Ease-in-out cubic on the full path + ease-out slide-in at the queue = accelerate from rest, coast through, decelerate into queue.

### Signal placement

Corner pole + overhead gantry per approach. Through+right head centered over the through lanes; LEFT head over the LEFT lane. Orientation matches road axis (vertical for N/S, horizontal for E/W). Lights reversed on N and W so RED always faces the approaching driver.

---

## What I chose not to build

Deliberate.

### Right-on-red
Requires car-following dynamics on outbound lanes to check merge room — a much bigger lift than the permissive-left check (which is a simple crossing, not a merge). Spec doesn't ask.

### Car-following / yield physics
Cars on bezier paths don't decelerate for each other. Non-conflicting paths by phase design, so no visual collisions in practice. Real physics would unlock right-on-red and full-fidelity permissive-left.

### Visual pixel regression
Render *geometry* is unit-tested (`render-smoke.test.ts`); render *output* isn't (would need Playwright). Manual screenshot iteration is the loop for a take-home.

### Right-lane as shared through/right
Spec says "a right turn lane" in contrast with "two middle lanes that go straight." I took that literally.

---

## What I'd build next

1. Tunable actuation policy — live `minGreen`/`maxGreen` sliders in the HUD.
2. Wait-time stats per movement (already tracked, just not surfaced).
3. Car-following dynamics → right-on-red.
4. Coordinated signals across multiple intersections (green wave).
5. Playwright visual regression tests.
6. Leading pedestrian intervals (LPI).

---

## Tests

```
conflicts.test.ts     19   compatibility rules, matrix symmetry, phase validation
controller.test.ts    31   ring, actuation, ped (concurrent), permissive-left
cars.test.ts           9   arrivals, parallel service, wait time, sensors
intersection.test.ts   5   World end-to-end
invariant.test.ts      7   global safety property test, clearance, determinism
permissive.test.ts     5   permissive service: snapshot + Poisson lookahead
render-smoke.test.ts   5   geometry: paths finite, stack monotone, snapshot well-formed
                      ──
                      82
```

The invariant test is the gate: any change that can cause two conflicting movements to be simultaneously green trips it.

---

## Configuration

All tunables in `src/config.ts` and `src/sim/cars.ts`:

```ts
minGreenMs: 4000,  maxGreenMs: 20000,  fixedGreenMs: 8000,
yellowMs: 2500,    allRedMs: 1500,
pedWalkMs: 7000,   pedClearanceMs: 4000,
defaultArrivalsPerMin: 12,

// cars.ts
TRANSIT_MS:           { STRAIGHT: 7035, LEFT: 8910, RIGHT: 4350 }
SERVICE_HEADWAY_MS:   { STRAIGHT: 1800, LEFT: 2500, RIGHT: 2000 }
APPROACH_MS: 1875     // slide-in animation
```

---

## LLM-assisted engineering

Built with Claude Code, iterative. See [`transcripts/`](./transcripts/):
- `workflow.md` — how I worked with the LLM (2 min read)
- `annotated.md` — 12 turning-point moments with what was kept / rewritten / rejected (**the one to read**)
- `raw-session.jsonl` — unedited session log

Highlights: picked the challenge by critically re-evaluating Claude's first recommendation; added the safety invariant property test *before* the complex features so regressions would trip it; screenshot-loop for visual polish; caught real bugs via pushback (parallel sub-lane service, right-turn 360° loop from oversized control point, signal placement, mid-green walk timing).
