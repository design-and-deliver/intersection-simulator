# Workflow

How this was actually built.

## Tools
- **Claude Code** (Opus 4.7, 1M context) running in WSL on Windows
- **Vite + Vitest** for the dev server and tests
- Browser screenshots passed back to Claude via a `/gls` slash command (reads the latest screenshot from the OneDrive Pictures folder)

## Phasing

1. **Plan first, no code.** Spent the first ~10 turns picking the challenge (intersection vs. webhook) and writing a `plan.md` with explicit build order, time budget, and risk callouts. Reversed an early bad recommendation when I pushed back. The plan ended up describing 9 numbered build steps.

2. **Headless sim before any pixels.** Steps 1–3 (phase model, controller, cars) shipped with no UI — only Vitest. By the time the first canvas appeared in the browser, the conflict matrix and phase ring had unit tests. Bugs caught at this layer were diagnosed in milliseconds, not by screenshot ping-pong.

3. **Visual iteration as a feedback loop.** Once the canvas existed, the `/gls` command let me drop a screenshot into chat and Claude could see what I was seeing. This is where the loop was tightest — most of the visual polish happened across short turns of "here's what I see / here's the fix / refresh."

4. **Property test as a gate.** Before adding the more complex features (actuation, pedestrian phase, permissive-left), I had Claude write the global safety invariant property test (10 sim-minutes × 5 traffic scenarios). Every feature that came after had to pass it. Two real bugs were caught this way during development.

5. **Final eval before README.** I asked Claude for a fresh-eyes 1–10 rating against the spec. It said 7. We then walked through the gaps in priority order — README, transcripts, and so on — implementing each as a deliberate fix.

## What worked

- **Keeping the simulation pure.** All 69 tests run in Node with no DOM. The same `tick(dt)` code path runs in the browser. Bugs reproducible in a unit test rather than "let me screen-record this".
- **Pushing back on bad recommendations.** Claude's first instinct was webhook-delivery; I asked it to re-evaluate against the rubric, and it correctly reversed itself. Same pattern repeated several times during visual polish — Claude would propose a fix, I'd push back ("hey those don't look like real stoplights"), Claude would reconsider and produce a better version.
- **Explicit "I don't have what I need" gates.** Before starting step 4 (canvas), Claude paused to ask whether I'd be available to provide screenshots in real time. That single question saved a long async loop.

## What I'd do differently

- **Earlier visual checkpoint.** I let several geometry assumptions accumulate in code before the first paint. Two hours of polish came from misreads that a 5-minute sketch could have flagged.
- **Capture transcripts as they happen.** I left transcripts to the end. Doing this fresh is harder than annotating live moments. Next time I'd flag "this is interesting, save it" inline.
- **Trim the renderer earlier.** The renderer has accreted a lot of geometry that, in retrospect, deserved its own module. Sim/render separation is clean; render-internal organization is OK but not great.
