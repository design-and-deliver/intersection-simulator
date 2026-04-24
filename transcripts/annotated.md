# Annotated Highlights

Twelve moments from the build session that show the *skill* of working with the LLM, not just the use of it. Each entry: what happened, what was kept, what changed, and (where it matters) why.

---

## 1. Picking the challenge — the first reversal

**My prompt:** "Read the zip file and create a plan for the impl"

**Claude's first move:** Recommended **WEBHOOK_DELIVERY** over INTERSECTION, framing intersection as "UI-heavy."

**My pushback:** "are u sure that the zip file provides the option of picking 1of 2 challenges?" → "ok so u said intersection is more ui heavy?"

**Claude's reversal:** Re-read the spec, conceded the UI framing was wrong (the spec literally says "you could build a terminal UI"), then re-mapped both challenges against the actual rubric criteria. The rubric explicitly weights "what data structures do you use" and "what algorithm do you implement" — both stronger fits for intersection.

**Outcome:** Plan rewritten for intersection.

**Why this matters:** First instincts are not always right. The rubric language was sitting in the spec the whole time; Claude had pattern-matched on "webhook = production engineering" without weighing it against what was actually being graded.

---

## 2. Numbered steps — collapsing redundancy

**My prompt:** "hey i dont see numbered steps listed in your plan -- do they exist there?"

**Plan had two near-identical numbered lists:** "Feature priority order" (1–9) and "Build order" (1–9). Same content, different framing.

**Fix:** Collapsed to one canonical list. Lead-in line says it's both the priority answer (rubric-relevant) and the build order (operational).

**Why this matters:** Two lists looked thorough but were noise. A plan that has the same idea twice has a plan-quality problem. The user caught it; the LLM shouldn't have shipped it.

---

## 3. Transcripts as a graded deliverable

**My prompt:** "oh yeah i think the zip file wanted transripts huh"

**Spec language is unambiguous:** *"If you use LLMs and don't include the transcripts we'll assume you didn't read this section carefully enough."*

**Decision made before any code:** Add a `transcripts/` section to `plan.md` with three files (raw / annotated / workflow), capture-discipline notes ("annotate live, not retro"), and budget time for it (40 min).

**Why this matters:** This file exists because of that conversation. A graded deliverable that ships as a noisy raw dump is worse than no deliverable at all.

---

## 4. The cars-cutting-through-oncoming-lanes bug

**My prompt:** "no cars are turning into oncoming traffic -- the cars need to make a bigger/wider turn to stay in their lanes and avoid a head on collision lol"

**The bug:** Cars turning left from N (heading east) were briefly crossing through the *NW quadrant* of the intersection — the same area S-LEFT cars (heading west) would occupy. Visually clear in the browser; the property test didn't flag it because flashing-orange isn't a "green" movement and protected lefts don't actually conflict at the *destinations*, only along the *paths*.

**Claude's first attempt:** Used a quadratic Bezier with the corner as the control point — `(entry.x, exit.y)`. This pulled the curve toward the wrong quadrant.

**The diagnosis:** Quadratic Bezier with corner control is geometrically incompatible with proper US "pass left-to-left" lane discipline.

**The fix:** Switched to a **cubic Bezier** with control points placed *in the destination quadrant*:

```
N→E (dest=SE): p1=(C+W, C), p2=(C, C+W)
S→W (dest=NW): p1=(C-W, C), p2=(C, C-W)
E→S (dest=SW): p1=(C, C+W), p2=(C-W, C)
W→N (dest=NE): p1=(C, C-W), p2=(C+W, C)
```

Each turn now arcs through its own destination quadrant. Opposing left-turners pass on opposite sides of the intersection center. Verified visually.

**Why this matters:** The user was right that something was wrong; Claude's first geometric intuition was wrong; the fix required actually reasoning about what real intersections do (left-to-left passing convention). This is the kind of moment that shows the value of the human-in-the-loop.

---

## 5. The right-turn 360° loop

**My prompt:** "in the current webpage -- when a car takes a right hand turn from its current lane -- looks like the car does a full loop in the intersection before taking the right hand turn"

**The bug:** Right turns are tight (~38px from entry to exit on the geometry). Claude was using a fixed control magnitude `d = HALF_INTERSECTION * 0.6 = 60`, which exceeded the entire turn distance. The result: the second control point landed *past* the destination, yanking the tangent direction backward and producing a visible 360° rotation.

**The fix:** Made `d` proportional to entry-to-exit distance for RIGHT turns:

```ts
const d = kind === 'STRAIGHT'
  ? HALF_INTERSECTION
  : Math.hypot(bezierEnd.x - entry.x, bezierEnd.y - entry.y) * 0.55;
```

For a 38px right turn, `d` becomes ~21. Path stays tight, no spin.

**Why this matters:** Magic constants in geometry are landmines. The fix scales with the actual problem size.

---

## 6. The "only one green car proceeding" bug — parallel service

**My prompt:** "when the light is green for the green car lane -- why is only 1 green car proceeding? ie why are all the other green cars stuck at the crosswalk"

**The bug:** STRAIGHT movements have 2 physical sub-lanes, but the service code released *one* car per headway from a single shared queue. Real intersections release cars from both lanes in parallel. Throughput was 1 car per 1.8s instead of 2 per 1.8s — and arrival rate was tuned for the parallel rate, so queues grew indefinitely.

**The fix:** Per-sub-lane cooldowns. Each tick, each sub-lane independently picks the front car of *its* sub-lane (the first car in the queue with matching `subLaneIndex`) and releases if its own cooldown is at zero.

**Test broke as expected:** The headway test was asserting old serial throughput (3–5 cars over 5400ms). Updated to the new behavior (6–8 cars = 2 sub-lanes × ~N+1 each), with the test name updated to reflect "parallel service across sub-lanes."

**Why this matters:** A user observation ("seems slow") triggered the diagnosis. The bug had been hiding in plain sight — it would have been hard to notice without watching the demo run for a while. Visual demo + a careful user catches things tests miss.

---

## 7. Stoplight placement — the long polish saga

This took ~10 turns and is worth retrospecting on as a single unit.

**Iteration arc:**

1. **First attempt** — corner-mounted near-side, signals at hardcoded offsets. The through signal landed *outside* the road (x=275 when the road starts at x=300).
2. **Far-side overhead** — moved signals past the far stop line, centered over each lane. Looked clean in the abstract but landed signals on top of crosswalks.
3. **Rotated horizontal "gantry bars"** — user feedback: "those don't look like real stoplights, they look like horizontal candy bars."
4. **Combined fixture at corner with pole + arm** — closer, but the user wanted lane association: "centering the stoplight groups in the center of its respective lane."
5. **Lane-centered, each head over its lanes** — user wanted them grouped: "u lost the side by side grouping."
6. **Grouped + horizontal lights** — user clarified: "the lights should still be vertical on the vertical axis."
7. **Per-axis orientation** (vertical for N/S, horizontal for E/W) — finally close.
8. **Per-quadrant flips** — bottom-left and bottom-right needed light order reversed (so RED appears on the side facing the direction of travel, not the side facing the driver).

**What the LLM got wrong repeatedly:** The LLM kept trying to optimize on a single axis (placement OR orientation OR grouping OR ordering) when the user wanted *all* of them to look right *together*. This is a pattern: when given a polish task with multiple soft constraints, the LLM tends to over-fit on the most recent one and break a previous one.

**What worked:** Short tight feedback loops with screenshots. The user wasn't writing detailed specifications; they were describing what they saw and what they wanted. Each iteration was small, verifiable.

**Why this matters:** Polish is genuinely hard for LLMs to do unsupervised because there's no test that says "this looks right." The screenshot loop is the test.

---

## 8. Slide-in animation — closing the visual gap

**My prompt:** "i see that cars randomly pop into the lane at the stop light intersection -- can u confirm that behavior is curr working as expected according to instructions?"

**Honest answer from Claude:** Yes, that's what the code does. The spec doesn't require otherwise. But it's a visual gap.

**Two options offered:**
- Cheap (~15 min): position lerp from off-screen to queue slot
- Real (~30–45 min): physical approach road model with car-following

**User picked cheap.** Implemented as a 800ms slide-in with a hard rule that front-of-queue cars can't be released until their slide-in completes (otherwise the car would teleport mid-slide into the intersection bezier).

**Why this matters:** Showed both options honestly with time/quality tradeoffs. User picked the right one for the budget.

---

## 9. Right-on-red and right-lane shared use — disciplined scope

**Two extension ideas the user raised, both interesting, both declined:**

> "do the instructions provide any details about right lane behavior? eg cars in right lane should only turn right, right on red rules, etc?"

**Claude's answer:** Spec is silent on right-on-red and lane-assignment enforcement. My implementation makes the conservative choice (right-lane-only-turns-right, no right-on-red).

> "1 car uses right lane for right hand turn, the next car uses right lane to go straight -- that would demo both use cases and be pretty real world right?"

**Claude's answer:** Defensible reading of the spec, but it does conflict with the spec's exact words ("a right turn lane" listed in contrast with "two middle lanes that go straight"). Recommended sticking with spec.

**User's response:** "if the spec specifically calls out the far right lane as 'the right turn lane' then its prolly safer just to treat that as a right hand turn lane for now."

**Why this matters:** Both ideas would have been ~30-45 min of work each. We were already past time budget on bigger spec items (actuation, ped, flashing-orange). Disciplined "no, document and move on" is what kept the project finishable.

---

## 10. Property test before more features

**My ordering:** After step 4 (canvas), I asked which feature to do next. Claude picked **the invariant property test** even though it's not user-visible, because the upcoming features (actuation, ped, flashing-orange) all mutate the controller's state machine in non-trivial ways. Locking the safety guarantee in place first means any of those changes that breaks safety fails the build.

**Result:** The test caught zero bugs at the time it was added (the controller was correct), but it serves as the gate for all future changes. The property is the right thing to assert at this layer; it would have caught the "permissive-left adds itself to the green set" mistake if Claude had made it.

**Why this matters:** Tests-as-gates is a standard SE pattern but easy to skip when working with an LLM that can produce features faster than a careful human can. The plan called this out explicitly ("step 5 gates further work") which reminded both of us not to skip it.

---

## 11. Per-quadrant stoplight flipping — the picky-but-right detail

**My prompt:** "the bottom left light collection needs to be flipped upside down" → "the stack order of lights in the bottom right hand corner needs to be reversed"

**The geometry:** Each fixture is in a specific quadrant of the screen. RED-on-top is the universal real-world convention, but "top" depends on which way the signal *faces*. For N-approach signals (south of the intersection, facing N driver), the side of the signal "facing" the driver is the south face — so RED should be on the canvas-bottom side, not the canvas-top.

**Generalized rule:** RED should appear on the side **furthest from the approaching driver** (the "ahead" direction in canvas coords).
- N (driver from N → ahead is +y): R at higher y → flip (canvas-bottom)
- S (driver from S → ahead is -y): R at lower y → no flip
- E (driver from E → ahead is -x): R at lower x → no flip
- W (driver from W → ahead is +x): R at higher x → flip

Implemented as a `signalIsFlipped(approach)` function that reverses the colors array. Each approach reads "right-side-up" relative to its driver.

**Why this matters:** The user iteratively requested fixes for two specific quadrants. Claude could have asked clarifying questions ("should I flip W too?") but instead waited for the user to specify each one. In retrospect Claude could have inferred the pattern earlier and offered a complete fix.

---

## 12. The honest 7-out-of-10 self-evaluation

**My prompt:** "i want u to eval the curr impl against specs with a fresh perspective -- how would u rate the curr solution against the instructions -- including qualitatvie aspects -- on a scale from 1-10?"

**Claude's response:** 7/10. Walked through each rubric criterion individually. The biggest single negative was the missing README (worth ~1.5 points), then missing transcripts (~1 point), then a list of polish gaps. Concrete plan to bump to 9 with ~1 hour of focused work (README + curated transcripts).

**Why this matters:** Fresh-eyes self-evaluation is something LLMs typically over-rate themselves on. Asking for a numeric score with rubric breakdown forced honesty. The user then asked to walk through the gaps one by one and fix them — which is how this very file came to exist.

---

## Patterns from the session

- **The user steered, the LLM didn't.** Most of the best decisions in this build (collapse the redundant numbered lists, reverse the challenge pick, switch to cubic Bezier with destination-quadrant control points, parallel sub-lane service) came from user observations, not LLM initiative.
- **Visual polish is a screenshot loop.** Tests can verify simulation correctness in milliseconds. They cannot verify "does this look like a real stoplight." That loop is human-paced.
- **Property tests scale.** Writing the invariant test before adding 3 more features paid for itself immediately.
- **Honest self-evaluation requires structure.** "How am I doing?" gets a self-rating bias toward 8. "Score against this rubric, criterion by criterion" gets 7 with reasons.
