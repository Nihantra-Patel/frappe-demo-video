---
name: frappe-demo-video
description: Generate a polished, Screen-Studio-style demo video (wallpaper window, glide cursor) of a Frappe/ERPNext/HRMS feature by driving the real app headlessly with Playwright and DETERMINISTICALLY rendering it frame-by-frame (not real-time screen capture). Use when asked to record/screen-capture a product walkthrough or feature demo of a Frappe-based app (HR, Payroll, Lending, etc.).
---

# Frappe demo-video generation

Produce a hands-off MP4 that walks through a Frappe feature, styled like Screen Studio
(app in a rounded window on a desktop wallpaper, glide cursor + click ripples). Fully automated — no manual record button, no Screen Studio app.

**Smoothness comes from DETERMINISTIC frame rendering, not real-time capture.** Screen
Studio is smooth because it renders every frame offline; a 25fps screen recording + ffmpeg
interpolation cannot match it. So this skill renders each output frame explicitly: cosmetic
motion (cursor glide, ripple, dwell) is tweened in Node — one eased step per frame,
CSS transitions DISABLED — then a raw CDP `Page.captureScreenshot` grabs that exact frame.
N frames @ 60fps = genuinely smooth motion with zero ghosting.

> **This is the ONLY approved method — use it for every video.** Do NOT fall back to
> Playwright `recordVideo`, ffmpeg `minterpolate`/`setpts`, or any real-time screen capture;
> they produce the ghosty, choppy output this pipeline exists to replace. The rules below were
> each paid for in real debugging — honor them exactly.

## For a new video: use `assets/run-flow.mjs`, not a copied/edited script

**Default to this. Do not write or copy a new `.mjs` storyboard file for a video request —
describe the flow as a plain JSON step list instead, and run it through the one generic
`run-flow.mjs`.** This is the whole point of `run-flow.mjs`: someone hands you a flow in plain
words ("Create the Lead, show its print preview, back to the list, then an Opportunity...") and
you translate that directly into a `steps.json`, you don't write any JavaScript.

1. Write `steps.json` as an ordered list of `{action: input}` objects — one entry per beat of
   the flow, in order, nothing required or assumed (no mandatory print/report/list stage; only
   include what the flow actually needs). Each `action` name is a primitive from
   `run-flow.mjs`/`reference-demo.mjs` (`newDoc`, `setField`, `saveForm`, `submitForm`,
   `openPrintView`, `backToListView`, `searchAndCreateNew`, `switchListView`, `runReport`, etc.)
   — see `run-flow.mjs`'s own header comment for the full list and exact input shape per action.
   A later step can reference an earlier step's generated document name with `"{{Doctype.N}}"`
   (the Nth document of that doctype created so far this run) without knowing the real name in
   advance — e.g. `{"setField": {"party_name": "{{Lead.1}}"}}`.
   ```json
   [
     {"newDoc": "Lead"},
     {"setField": {"first_name": "Demo", "last_name": "Prospect", "email_id": "demo@example.com"}},
     {"saveForm": true},
     {"openPrintView": true},
     {"closeExtraTab": true},
     {"backToListView": true},
     {"searchAndCreateNew": "Opportunity"},
     {"setField": {"opportunity_from": "Lead", "party_name": "{{Lead.1}}"}},
     {"saveForm": true}
   ]
   ```
2. **The opening beat is automatic — don't write it yourself.** The FIRST `newDoc`/
   `searchAndCreateNew`/`searchAndOpenDoctype` step of a whole run automatically starts from the
   desk Home screen first; and the first time a flow visits any GIVEN doctype, it automatically
   goes through the real navbar search to that doctype's list before creating — exactly how a
   real user actually gets there ("Home → search 'Loan' → Loan list → + Add Loan," not a cold
   jump to a `/new` URL). A flow creating several documents of the SAME doctype back to back
   only gets this once, for the first one — a real user doesn't re-search for something they're
   already looking at. You never need a `{"comment": "go to home and search first"}`-style step
   for this; it's a property of `newDoc`/`searchAndCreateNew` themselves, not a separate action.
3. Run it: `BENCH=<path> DEMO_URL=http://<site>:8000 DEMO_USER=Administrator DEMO_PASS=<pwd>
   ./make-video.sh` with `STEPS=steps.json` (or just drop `steps.json` in the project directory
   — `make-video.sh` picks it up automatically if neither `STEPS` nor `SCRIPT` is given).
4. **Reset is automatic too — there is no `reset-demo.py` to hand-write.** Every document the
   run actually CREATES is tracked (by doctype + the real name it gets on first save) into
   `output/created-docs.json`; `make-video.sh` runs `run-flow.mjs <steps> --reset-only` before
   the next render, which deletes exactly those documents server-side (cancelling first if
   submitted), generically, for ANY doctype — not a doctype-specific script someone has to write
   and keep in sync with the flow by hand.

**When a copied/edited `.mjs` storyboard is still the right tool**: a flow that genuinely needs
custom JS logic a plain action sequence can't express — conditional branching on a value read
mid-flow, a loop over a dynamic list, or a bespoke off-camera `bench()` step wired into the
storyboard's own timing (see "Features whose buttons enqueue background jobs" below). For that
rare case, copy `assets/reference-demo.mjs` and edit only `run()` — the harness (stage, cursor,
capture, primitives, boot, auth) is identical to `run-flow.mjs`'s, just not driven by a JSON
file — and keep `assets/reset-demo.py` as its own hand-written reset, same as before.
`make-video.sh SCRIPT=your-script.mjs` runs that path explicitly.

### How to actually verify "smooth" — don't just eyeball it
`ffprobe`'s frame timing is the objective signal, and it is generic to any output
(this skill's render, a human screen recording used as a reference, a competitor's demo):

```bash
ffmpeg -i out.mp4 -vf showinfo -f null - 2>&1 | grep pts_time | grep -o "duration_time:[0-9.]*"
```

- **This skill's output should show exactly one value: `duration_time:0.0166667`** (1/60s) on
  every line, zero variance — that's what "every frame is a real render at a constant 60fps"
  means concretely, and it is the thing to check after any harness change that touches `cap()`,
  `hold()`, or encoding. If any line differs, something is capturing in real time or dropping
  frames, not tweening deterministically — treat that as a regression, not a style choice.
- **A real-time screen recording (QuickTime, a competitor's demo, a reference video a user
  hands you) will show widely VARYING durations** — commonly swinging between ~0.0166s and
  0.3s+ in the same clip, because the OS captures adaptively based on how much of the screen is
  actually changing. This is not a flaw specific to any one recording; it is structurally how
  real-time capture works, and it is exactly the ghosting/choppiness this skill's deterministic
  pipeline exists to avoid (see the callout above). A variable-duration reference video is
  useful for confirming NAVIGATION (which routes a real user hits, what a real UI looks like)
  but is never the smoothness bar to match — this skill's constant-60fps output is already
  strictly smoother than any real-time capture can be, by construction.
- Don't confuse "the reference video has natural human cursor movement" with "therefore human
  capture is smoother." The cursor path being organic and the frame timing being smooth are
  independent — this skill's eased, deterministic cursor glide is designed to read as natural
  motion (see "Cursor smoothing" rules below) while keeping perfectly uniform frame timing,
  which a human recording cannot do simultaneously.

## Workflow (do these in order)

1. **Locate the running bench + site.** Find the bench directory and the port its web server
   runs on (Frappe defaults to `:8000`). Confirm which site has the target app installed
   (`bench --site <site> list-apps`). Reach it at `http://<site>:<port>` (multi-site resolves
   by Host header; site hostnames are usually in `/etc/hosts`).
2. **Check the shared app's git branch FIRST** (`git -C apps/<app> branch --show-current`).
   Feature code and even required doctype modules differ across branches — a backport/hotfix
   branch can be missing modules the flow needs (see "Working on a shared bench"). If the
   branch is wrong, ask before switching; restore it when done.
3. **Understand the exact UI** before scripting: doctype fieldnames, tab labels, report
   filter fieldnames. Run `assets/get-schema.py <doctype>` (a thin wrapper around
   `frappe.get_meta()` — see "Doctype schema lookup" below) to get every field's name, type,
   and mandatory status in one shot instead of opening the raw doctype `.json` by hand; use an
   Explore agent for anything it doesn't cover (tab labels, report filters, client-script
   behavior). Never guess fieldnames.
4. **Prove the data flow with a bench dry-run** BEFORE recording. Confirm the feature actually
   computes/renders (e.g. submit the doc server-side). A video of a broken flow is useless.
5. **Write `steps.json`** (see "For a new video: use `assets/run-flow.mjs`" above) — a plain
   ordered action list, not a `.mjs` script. Reset is automatic (tracked-docs + `--reset-only`),
   so there is no `reset-demo.py` to write for this path.
6. **Set a known admin password** (`bench --site <site> set-admin-password ...`) for auth.
7. **Render → encode → verify by reading frames → iterate.**

## Doctype schema lookup — a tool for YOU, not an auto-storyboard generator
`assets/get-schema.py <doctype>` runs `frappe.get_meta(doctype)` server-side and prints every
field's name, label, type, `reqd`/`hidden`/`read_only`/`depends_on`/`default`, plus which
child tables it owns and whether it's submittable — as JSON, so step 3 above doesn't mean
opening and reading a raw doctype `.json` file by hand every time:

```bash
DEMO_SITE=<site> bench/env/bin/python assets/get-schema.py <doctype>
```

**This is a lookup you run once while planning, and then write `run()` by hand from the
result — it is deliberately NOT wired into an "auto-generate the whole storyboard" pipeline,
and should not become one without re-reading this paragraph first.** Metadata alone cannot
see:
- a `fetch_from`/`set_value` client-script trigger on a field (metadata shows the field exists,
  not that typing in a sibling field will silently populate or overwrite it — see "A 'copy if
  empty' field-change trigger..." above for a bug this exact gap already caused once)
- `depends_on` conditions that evaluate OTHER live field values at runtime, not just the raw
  expression string (the schema gives you the expression; knowing whether a field is actually
  visible for the demo data you've chosen still requires checking by hand or in a dry run)
- custom `validate()`/`before_save()` server logic that silently requires something metadata
  never mentions (SKILL.md's reset-between-takes section already names this pattern: "a
  challan's tax breakup rather than its deposited total")
A storyboard planned from schema alone, with no server-side dry run, is exactly the kind of
"looked right from the metadata, broke on the actual form" failure every other fix in this
file exists to prevent. Use the schema dump to know what fields exist and which are mandatory
— still do the dry-run in step 4 before trusting any of it on camera.

## A generic CRUD+print storyboard shape
Most "demo this doctype" requests decompose into the same beats, regardless of module —
use this as the default shape and adapt field names/doctype, not the shape itself:

1. **Create**: `newDoc(doctype)` for the FIRST doctype of a run (there's no prior screen to
   search from yet); for any LATER doctype switch within the same run, prefer
   `searchAndCreateNew(doctype)` (drives the real navbar search's "New <Doctype>" quick-create —
   see "Robustness primitives") so a multi-doctype flow reads as a person navigating the app, not
   a developer hitting routes. Either way, follow with `setField(...)` for each field that
   matters → `saveForm()` (or `submitForm()` if the doctype is submittable).
2. **Back to the list**: `backToListView()` — clicks the form's own breadcrumb link, the way a
   real user actually gets back to a list (see "Robustness primitives"). Confirm it loaded
   (`document.querySelector(".list-row")` — `backToListView()` already waits on this), then
   `scrollToY(...)` partway down so the list doesn't look frozen on row 1 — see "Opening a
   document from its list view" below for clicking into a row generically. A raw
   `gotoApp("/app/" + frappe_slug(doctype))` still works and remains documented for when there
   is no form on screen to click a breadcrumb from (e.g. the very start of a run).
3. **Open a document from the list**: `clickListRow(index)` — generic to every doctype's list
   markup, not just the one you just created (open "any row" to demonstrate the list → form
   flow itself, not just round-trip the one demo document). To switch to a DIFFERENT doctype
   from a list view instead, `searchAndOpenDoctype(doctype)` is the real-UI equivalent.
4. **Print preview**: `openPrintView()` — clicks the form's own Print icon through to the real
   "Full Page" button (see "Robustness primitives" / "Opening the print view on camera"). Going
   straight to `/printview?doctype=...&name=...&trigger_print=0` remains documented for a
   storyboard that genuinely wants a bare preview with no surrounding chrome. Scroll it if the
   print format is long enough to be worth showing (check — some doctypes render as a single
   short page, nothing to scroll).
5. **PDF**: `/api/method/frappe.utils.print_format.download_pdf?doctype=...&name=...`. Check
   the generated PDF's page count before planning a scroll beat on it — see "Opening a PDF on
   camera" for why the native PDF viewer can't be scrolled by this harness anyway, and for a
   single-page PDF there is nothing to scroll regardless.

Not every demo needs all five beats — a report-only feature skips 1-3, a settings toggle skips
2-5 — but when a request says "create X, do things with it, show the print," this is the shape
to reach for before inventing custom navigation.

**"Repost" doctypes (e.g. ERPNext's Repost Accounting Ledger / Repost Item Valuation) have no
special list-view trigger** — verified against ERPNext source: no `add_action`, no bulk "Actions"
menu entry, no per-row button anywhere for any Repost* doctype. Every custom button on them
(Start Reposting, Show Preview, Restart) is added in the FORM's own `refresh()`, only visible
once you're already on the document. Demo these as a plain doctype: list → new → fill → save,
same as any other doctype in this shape — don't go looking for a bulk-repost list action that
doesn't exist.

## Rendering architecture (these are the load-bearing decisions)

### Deterministic per-frame tweening — NOT real-time capture
- Keep a global frame counter. A `cap()` helper does a raw CDP
  `Page.captureScreenshot` and writes `output/frames/%06d.png`. Motion primitives
  (`glide`, `ripple`) loop `n = round(durMs/16.67)` times, each iteration
  computing an eased position/scale in **Node**, `evaluate`-ing it into the page (transitions
  OFF), then `cap()`. Dwells (`hold(ms)`) capture one real frame and cheaply `fs.copyFileSync`
  it for the rest. make-video.sh encodes the sequence at a constant 60fps.
- **Do NOT rely on CDP virtual time to drive CSS.** `Emulation.setVirtualTimePolicy` does
  advance `Date.now`/`setTimeout`/network-pausing, but it does **NOT** advance CSS transitions
  or `requestAnimationFrame`-based animation in this headless build (verified — a mid-flight
  transition stays frozen when you advance virtual time). Driving CSS deterministically would
  need `--enable-begin-frame-control` + `HeadlessExperimental.beginFrame`, which is fragile.
  Explicit Node-side tweening sidesteps all of it and never deadlocks.
- **Use raw CDP `Page.captureScreenshot`, NOT Playwright's `page.screenshot`.** The Playwright
  wrapper waits for a fresh compositor frame / fonts and **hangs** mid-animation; the raw CDP
  call grabs the current surface immediately and is faster (matters for thousands of frames).
- **Retina:** `Page.captureScreenshot` ignores `deviceScaleFactor`. Set `deviceScaleFactor: 1`
  on the context and pass `clip: {x,y,width,height, scale: 2}` to render at 2× (the current
  1600×900 CSS viewport → crisp 3200×1800 frames). See "`VIEW.width` must stay..." below for
  why 1600, not a narrower viewport — it's not just about retina crispness.

### Interactions run in wall-clock and are NOT captured
- Real interactions (navigation, `set_value`, save, submit, report refresh) run in normal
  wall-clock time between animation beats and produce **no frames** — they're near-instant
  visually, so the video cuts cleanly from before-state to after-state (snappy, Screen-Studio-like).
  Only cosmetic motion + dwell generate frames.
- **"Near-instant" is the load-bearing assumption — a `sleep(ms)` that isn't is a bug, not a
  stylistic choice.** `sleep()` with nothing after it but another action produces a genuine
  dead stall: the video holds the PRE-action frame for the full duration (zero frames
  generated, because nothing calls `cap()`), then jump-cuts to the result. On playback this
  reads as "nothing happens for 2-3 seconds after a click" — exactly the symptom to watch for.
  This was a real bug fixed in the harness: `waitForm`, `newDoc`, `reloadDoc`, `clickGroupItem`
  and `runReport` all used to end (or stack) a bare `sleep()` after their real readiness wait,
  purely as a safety margin — multiple of these chained back to back (e.g. `newDoc` calling
  `waitForm` which itself slept, then sleeping again) could add 1-2+ seconds of pure stall to
  a single step. Fixed by converting every such trailing/stacked `sleep()` into `hold(ms)` of
  the same duration — same wall-clock wait, but now it actually captures the settled state as
  real dwell frames, so the pause reads as a deliberate beat, not a freeze.
  - **Rule for new storyboard code:** a `sleep()` is fine ONLY when something immediately
    measurable follows it in the same function before the next `cap()`/`hold()` (e.g. "let a
    reflow settle, then call `rectOf`") — i.e. it's a technical wait with nothing yet worth
    showing. A `sleep()` as the LAST thing after a real wait condition, or stacked directly
    before a `hold()`, should be a `hold()` (or merged into the next one) instead.
  - Retry/error-recovery sleeps (a failed nav, a 5xx retry backoff) are the one standing
    exception — they only fire on failure, so they don't cost smoothness on a normal take.

### Scrolling (captured, not instant)
- Long forms/reports need a visible scroll, not a `scroll_to_field`/`scrollIntoView`
  teleport — an instant jump captures zero frames, so the page snaps under the cursor and
  reads as broken. Use `scrollToSel(sel, durMs)` (forms — walks up to find the actual
  scrolling ancestor, falling back to `document.scrollingElement`, and tweens `scrollTop`
  frame-by-frame exactly like `glide` tweens cursor position) and `scrollReportBody(px)`
  for a report's `.dt-scrollable` table body. `revealField()` already calls `scrollToSel`
  internally — call it (or `clickTab(label, anchor)`, which calls it) before `glideToSel`
  rather than reaching for the old instant scroll.
- Frappe's desk scrolls `document.documentElement` (see `form/layout.js`'s
  `$(".main-section").scroll(...)` handler reading `document.documentElement.scrollTop`),
  not a nested `overflow:auto` div — `scrollToSel` only looks for a closer scrollable
  ancestor and falls back to the document, so it's correct either way.

### Idle cursor, field focus, and typed text (viewer-legibility rules)
- **Idle cursor fade.** A cursor sitting frozen in frame during a long dwell (reading a
  report, narrating over a finished screen) looks like the recording hung. Use
  `holdIdle(ms)` instead of `hold(ms)` for any pause where nothing is about to be clicked
  next — it fades the cursor out, holds, fades it back in before the next glide. Keep
  `hold(ms)` for short beats between consecutive actions.
- **Field focus ring.** `setField()` now draws a focus highlight (`setFieldRing`) around
  the field being edited for the duration of the edit, then clears it — so the eye finds
  the right field even on a dense form, without needing zoom.
- **Typed text, not a one-frame fill.** `setField()` types Data/Text/Currency/Int/Float/
  Phone/Code fields character-by-character via repeated `cur_frm.set_value` calls (each
  captured), landing on the exact value at the end. Always a clean, even reveal — never
  simulate a typo or backspace; that reads as a mistake, not personality. Link/Select/Date/
  Check fields keep the one-shot `set_value` (there's no "typing" a dropdown pick).
- **The cursor must never sit on top of the text being typed.** The cosmetic cursor's arrow
  hotspot renders at almost exactly `(x,y)` (the overlay's `margin:-6px 0 0 -6px` is a
  near-zero offset), so a cursor positioned at the field's vertical text-center — where it
  used to be parked, aimed at the glyph baseline — visually covers the value as it's typed.
  `setField()` now parks the cursor just under the field's bottom-left corner (`r.x + 14,
  r.y + r.h + 14`) instead, re-measured every keystroke the same way the field ring already
  was, so it never occludes the text and still visibly tracks a field that reflows mid-type.
- **No zoom — still.** The spec items above (field highlight, typed text, idle fade) are
  how emphasis is delivered instead of zoom. A moving scale still resamples text every
  frame; don't add one. If a field is too small to read even highlighted, that's a `hold()`
  duration problem, not a zoom problem. **This has been proposed again since (an "Elastic
  Bounding-Box Zooming" / `zoomToElement()` feature) and declined again, explicitly, by the
  user** — treat it as settled unless a future request overrides it in so many words a THIRD
  time, not by re-describing the same feature under a new name.
- **No simulated typos, backspaces, or RANDOMIZED keystroke timing.** `setField()`'s
  character-by-character reveal uses a fixed, computed-from-length interval (see
  `perChar` in `setField`) — never a random variance. This has also been proposed again since
  ("Dynamic Keystroke Velocity" / "random normal distribution") and declined again,
  explicitly — same status as the no-zoom rule above. `hoverDwell()`'s pause is fixed for the
  same reason: deterministic timing is a property this harness deliberately keeps even where
  the RESULT should read as natural (see `hoverDwell`'s own comment).
- **Virtual time (`Emulation.setVirtualTimePolicy`) and GPU-passthrough rendering flags are
  not used, and re-proposing them without new evidence doesn't change that.** Virtual time
  does not advance CSS transitions or `requestAnimationFrame` in this headless build — tested,
  documented at the top of this file, and re-confirmed as still the settled finding when
  proposed again. GPU flags don't address the actual per-frame cost (`Page.captureScreenshot`
  is a software compositor readback regardless of rendering backend) and risk making renders
  non-reproducible across machines, which cuts against the whole deterministic-render premise.
  The actual, implemented speed win is async/queued frame writes (see "Performance: frame
  writes don't need to block capture" below) — pursue bottlenecks that are real and measured
  (disk I/O serialized with capture) over ones that sound plausible but were already checked.
- **Cursor size.** The cosmetic cursor is drawn at 64px (up from a smaller default) so it
  stays legible scaled down for mobile playback. Don't shrink it back for "subtlety" —
  legibility was the explicit ask.
- **Skip fields already correctly populated.** `setField()` now checks `cur_frm.doc[fn]`
  before doing anything and returns immediately if it already equals the value you were
  about to type — most commonly a `fetch_from` field auto-filled when its source Link was
  set (an address, rate, or description pulled from a parent record). Re-typing an
  already-fetched value on camera looks like the storyboard doesn't trust its own data, and
  wastes a beat the viewer has to sit through. If you need to deliberately OVERWRITE a
  fetched value with something different, that's still a normal `setField()` call (the skip
  only fires when the values already match).
- **A "copy if empty" field-change trigger will stop syncing after the first typed keystroke.**
  Some doctypes have a trigger like Item's `item_code: (frm) => { if (!frm.doc.item_name)
  frm.set_value("item_name", frm.doc.item_code); }` — intended to default a dependent field
  ONCE, the first time the source field gets a value. `setField()`'s typed-character loop
  calls `cur_frm.set_value` on every keystroke, so this fires after the very FIRST character
  (the dependent field was still empty then), copies just that one character across, and
  never fires again (the dependent field is non-empty from that point on) — leaving it
  visibly truncated to one character while the source field keeps growing to its full value.
  A real user typing in the actual browser input never triggers this, because Frappe's input
  control only commits on blur/Enter, not per keystroke — this is an artifact of the typing
  simulation, not a real app bug, and `setField()` calling `set_value` once more with the
  final string at the end of the loop does NOT fix it (the guard is already tripped). If a
  field you're typing has a sibling field that auto-populates from it this way, set that
  sibling explicitly with its own `setField()` call right after, rather than relying on the
  auto-copy — confirmed on Item's `item_code` -> `item_name`, likely true of any doctype with
  a similar `if (!frm.doc.X) frm.set_value(X, ...)` pattern in its own `.js` controller.
- **`setField()` scrolls to the field itself now — do not scroll separately first.**
  It calls `revealField(fn)` internally before measuring/gliding, so a field in a lower
  section/tab is brought into view as part of entering its value, not as a separate step an
  author has to remember. (Previously `setField()` assumed the caller had already scrolled;
  forgetting that step aimed the cursor/ring at a field that was off-screen or had a
  zero/stale rect — the "typed into the wrong place because the page never scrolled down to
  the lower section first" defect.)
- **Re-measure position before every click, not just once before the glide.** `glide()` +
  `ripple()` run for several hundred ms of real captured frames, and Frappe's UI can reflow
  DURING that window (a toast appearing, a dependent field's visibility changing, a modal
  still animating in, a list re-rendering) — if the target moves, a position measured only
  once before the glide leaves the cursor/ripple visually settled on the OLD coordinates
  while the click (fired against a re-queried live element, not literal x/y) still succeeds
  invisibly somewhere else. This reads as "the click went to the wrong place" even though
  the underlying action worked. Use `settleOnLive(sel, prevRect)` (or the inline re-check
  pattern in `clickTab`/`clickListRow`) right before the ripple/click on every click-driving
  primitive — it re-measures and does one short corrective glide (160ms, not a full re-travel)
  only if the target actually moved more than a few px. `setField()`'s typing loop applies
  the same idea per keystroke: it re-measures and redraws the field ring (and nudges the
  cursor) every character, not once before typing starts, since `set_value` itself can
  reflow the field's own position (error text, currency width, a sibling's depends_on).
  **`saveForm()` is a real, observed instance of this, not just a theoretical risk** — it
  glided to `.page-head .primary-action` once and rippled with no live re-check, and on a
  fresh `newDoc` navigation the page-head toolbar can still be swapping out the PREVIOUS
  doctype's buttons (e.g. "Templates"/"Create") while the glide is in flight, so the ripple
  visibly lands next to Save rather than on it. Fixed to re-measure via `settleOnLive`
  immediately before the ripple, same as `submitForm()` already did for its modal button —
  when adding any new click-driving primitive, treat `submitForm()`'s pattern as the one to
  copy, not `saveForm()`'s old one.
- **`saveForm()` skips the click entirely when the doc is already clean.** A caller
  re-invoking `saveForm()` defensively (e.g. uncertain prior state after an interception
  detour) on a doc that's already `!is_dirty() && !is_new()` used to still glide to Save and
  click it — harmless on a submittable doctype (another save is a no-op there) but on a
  **non-submittable doctype with no later submit step**, this was the visible "Save clicked
  multiple times" defect: nothing changes on screen between the repeat clicks, so it just
  reads as the recording stuttering. `saveForm()` now checks `cur_frm.is_dirty()`/`is_new()`
  first and returns immediately (a short `hold(300)`, no click at all) when there's genuinely
  nothing to save.
- **Always close an open child-table grid row before calling `saveForm()`.** If a flow uses
  `setGridField()` to edit a row opened via `row.toggle_view(true)`, call the new
  `closeGridRow(tableFieldname)` helper (does `row.toggle_view(false)`, the same call
  Frappe's own Escape-key/click-away handler makes) right before `saveForm()`. Saving with
  the row still open was observed to occasionally leave `cur_frm.is_dirty()` stuck `true`
  even though `cur_frm.save()` itself resolved without error — not reliably reproducible in
  an isolated repro, so treat it as a real but intermittent hazard rather than something
  you can unit-test away. `saveForm()` itself now also retries the save once if `is_dirty()`
  doesn't clear within 12s before giving up at a combined ~27s, as a second line of defense —
  but don't rely on the retry instead of closing the row; the retry is a safety net for a
  render already in flight, not a reason to skip the realistic close-the-row step.
- **Use `ensureGridRow(tableFieldname, keyFieldname)` before filling a child table row — do
  NOT click `.grid-add-row` directly first.** A fresh `newDoc()` can seed a child table with
  ONE EMPTY ROW ALREADY PRESENT — confirmed on Sales Order's `items` table, which starts with
  a blank row even on a brand-new document, not an empty table. Clicking "Add Row" without
  checking for this leaves TWO rows: the original seeded one (its mandatory fields, e.g.
  `item_code`, still unset) and the one `setGridField()` actually filled. `saveForm()`'s
  `cur_frm.save()` then hangs/times out on the dangling empty row's validation error, with
  nothing in the storyboard explaining why — this was a real render failure, not a theoretical
  one. `ensureGridRow` checks `cur_frm.doc[tableFieldname]` for a usable (empty-at-`keyFieldname`)
  last row and opens THAT via `row.toggle_view(true)` instead of adding a new one; it only
  falls through to clicking `.grid-add-row` when no such row exists.
- **Bridge off-camera time-jumps with a caption, don't cut silently.** An off-camera
  `bench()` call (see "Features whose buttons enqueue background jobs" below) can advance
  real application state by days/weeks in an instant — e.g. a classification job that makes
  a just-disbursed loan already show 45 days overdue. Cutting straight from "loan disbursed"
  to "already overdue" with nothing on screen explaining the gap reads as broken or
  confusing, not as "time passed." Use `asyncStep(group, label, script, bridgeText, ...args)`
  or `offCameraStep(bridgeText, fn)` and ALWAYS pass `bridgeText` (e.g. `"Running daily
  classification for the next 45 days…"`) for any off-camera step that advances date-driven
  state (classification, dunning, accrual, aging). It's optional only for steps whose effect
  is self-evident without narration (e.g. a background email send where the next on-camera
  beat is "here's the email that arrived").

### Captions / subtitles (burned-in, not a sidecar file)
- `caption(text, holdMs=1600, fadeMs=220)` shows a dark pill caption at the bottom of the
  STAGE (not inside the app iframe — it survives app navigation, SPA route changes, and
  switching to a new tab), fades it in, holds, fades it out, and clears the text. Call it
  right before/during a `hold()` whose content needs explaining to a non-technical viewer —
  e.g. naming which doctype is about to be created, what a status change means, or what an
  off-camera step just did (see the time-jump bridge rule above).
- `captionPersist(text)` fades a caption in and leaves it showing — use when the caption
  should stay up THROUGH a hold rather than fade before it (e.g. narrating over a background
  job's toast while it's still on screen); pair it with a later `clearCaption()`.
- **Burned-in, not `.srt`/`.vtt`:** this pipeline's deterministic frame sequence IS the
  video — baking the caption into the same captured PNGs keeps it exactly in sync with zero
  separate muxing/timing step, and a client opening the `.mp4` anywhere sees it without
  needing to enable a subtitle track. Do not add a sidecar subtitle file instead of this.
- Keep caption text short (one line, under ~70 characters) — it's a label for what's
  happening, not a transcript. Don't caption every single beat; reserve it for steps whose
  meaning wouldn't be obvious from the screen alone (status changes, time-jumps, what a
  number on screen actually represents) — captioning literally everything turns it into
  visual noise and fights with the on-screen UI for attention.

### Performance: frame writes don't need to block capture
- `cap()`/`dup()` write frames through `queueWrite()`, a bounded async queue
  (`fs.promises.writeFile`, not `writeFileSync`/`copyFileSync`) — the CDP screenshot round
  trip is the real per-frame cost; blocking the event loop on the disk write before starting
  the NEXT capture was pure serialization with no benefit. `MAX_PENDING_WRITES` (24) caps how
  far writes can lag behind capture so a slow disk can't let thousands of PNG buffers pile up
  in memory — this trades a *bounded* wait for an *unbounded* one, not speed for safety.
  `flushFrameWrites()` is awaited once at the very end of the render, before reporting success,
  so `make-video.sh`'s frame-count check can never race a still-writing tail frame.
- This is NOT the same idea as virtual time or GPU passthrough (both considered and rejected —
  virtual time doesn't advance CSS/rAF per the architecture section above, and GPU flags don't
  address the actual bottleneck since `Page.captureScreenshot` is a software compositor
  readback regardless of rendering backend). Async writes are safe because they don't touch
  rendering determinism at all — only how fast an already-rendered frame reaches disk.
- **`dup()` must reuse `cap()`'s buffer from MEMORY (`lastFrameBuf`), never read it back from
  disk.** `cap()` returns as soon as its write is QUEUED, not once it has actually landed —
  a `dup()` that did `fs.readFile(framePath(FRAME-1))` right after `cap()` could race that
  still-pending write and throw `ENOENT` on a frame that "exists" by `FRAME`'s own counter but
  isn't flushed to disk yet. This is not hypothetical: a real render failed this way at frame
  16, immediately after converting `cap()`/`dup()` to the async queue above. Fixed by having
  `cap()` cache its buffer in a module-level `lastFrameBuf` and `dup()` reuse that directly —
  every `dup()` call site in this file is already directly preceded by the `cap()` whose buffer
  it needs, so this is always correct, not a narrower fix than the bug. If you add a new
  `dup()` call site, it must follow the same pattern (call `cap()` immediately before it in the
  same block) or `lastFrameBuf` won't be the frame you think it is.

### Robustness primitives (generic to any doctype's UI quirks)
- **`getFrappeFieldSelector(labelOrFieldname)`** — tries `[data-fieldname="..."]` first; if
  that resolves to nothing/zero-size (a Customize Form rename, or you only know the on-screen
  label), falls back to matching `.control-label` text and returns THAT field's real
  `data-fieldname` selector, which then works with every other primitive unchanged (`setField`,
  `revealField`, `rectOf`). Confirmed from `base_input.js`: every field wrapper renders a
  `label.control-label` next to its own `[data-fieldname]`.
- **`setFrappeLinkField(fn, query, {pick})`** — drives a Link field through its REAL
  Awesomplete search UI (focus → type into the actual `<input class="input-with-feedback">` →
  wait for `ul[role="listbox"]` to populate with `li[role="option"]` rows → glide to and click
  one → wait for `fetch_from` dependents) instead of `setField()`'s one-shot `set_value`. Use
  this when the search-and-pick interaction itself is the thing worth showing on camera;
  `setField()` remains faster and fine for Link fields where the dropdown isn't the point.
  Falls back to a plain `set_value` if the query returns no results, rather than leaving an
  open empty dropdown on screen.
- **Sticky-header scroll compensation** — `scrollInfo()` now measures `.page-head` and
  `.form-tabs-list` (both `position: sticky` per `page.scss`/`form.scss`) and treats their
  rendered height as dead space when centering a target vertically. Without this, a field
  centered against the FULL viewport height can land with its top edge hidden under one or
  both of these overlaying bars even though the scroll math says it's "in view" — they overlay
  rather than reflow the layout, so `clientHeight` alone doesn't account for them.
- **`handleFrappeTableReorder(tableFieldname, fromIdx, toIdx)`** — reorders a child-table row:
  cosmetic glide+drop gesture for the camera, but the REAL move goes through Frappe's own
  `grid.renumber_based_on_dom()` (confirmed in `grid.js`: SortableJS's own `onUpdate` handler
  calls this exact function after a real drag) rather than simulating SortableJS's native drag
  events, which this harness's "cursor is cosmetic, the real action is driven in JS" rule
  already says not to fight. Moves the row's actual DOM element (the one `.rows` contains,
  verified against `make_sortable($rows)`'s source), then calls the same reindex function a
  real drag-drop would trigger.
- **`hoverDwell(ms=180)`** — a short, FIXED (not randomized — see "No simulated typos/
  randomness" above for why) pause between a `glide()` landing on a target and the `ripple()`/
  click that follows. Without it, arrival and click happen in the same instant, which reads as
  the cursor "teleporting and instantly firing" rather than a deliberate click. Wired into
  `clickTab`, `saveForm`, `submitForm`, `clickListRow`, `clickCustomButton`, and
  `clickGroupItem` — add it to any new click-driving primitive the same way (right before the
  `ripple()` that follows the final glide/`settleOnLive`).
- **`interceptFrappeModals({timeoutMs, captionIt})`** — checks for an UNEXPECTED dialog (a
  validation error, a confirmation prompt you didn't plan for — e.g. "Item code matches an
  existing template...") after an action that might trigger one, captions its title/body text,
  and clicks its primary action via the same generic `.btn-modal-primary` selector
  `submitForm()` already uses for its own (expected) confirm dialog. This is NOT a background
  poller — the harness has no concurrent execution, `run()` is strictly sequential — call it
  explicitly right after a save/custom-button/status-change that might surface a dialog you
  didn't account for. An EXPECTED dialog (submitForm's own confirm) should keep using its own
  direct wait, not this. **If the dialog has no primary action at all** (a plain
  `frappe.throw()`/`frappe.msgprint()` error with nothing to confirm — e.g. "Missing Fields"),
  it falls back to clicking the dialog's real close ("X") icon, `.btn-modal-close` — verified
  against current Frappe source (`dom.js`'s `frappe.get_modal()` builds the header with exactly
  this class, and `dialog.js`'s `get_close_btn()` confirms it as the canonical lookup; it is
  **not** `.modal-header .close` — that's plain Bootstrap markup Frappe does not use here).
  Every error/info dialog must be closed one way or the other before the storyboard moves on —
  never leave one sitting open on screen.
- **`backToListView()`** — "back to the list" the way a real user does it: clicks the
  doctype's own breadcrumb link at the top of the form (`nav.es-breadcrumbs
  a.es-breadcrumbs__item:first-child`), not a cold `gotoApp` to the list route. Verified against
  current Frappe source (`breadcrumbs.js`): the crumb trail is `nav.es-breadcrumbs`, each
  segment an `a.es-breadcrumbs__item`; the current document's own name is the LAST crumb and is
  a plain `span` with no href, while the doctype's own crumb (first `<li>`) is a real link to
  `/desk/<doctype-slug>`. Generic to any doctype — `frappe.ui.form.get_breadcrumbs()` builds it
  the same way everywhere.
- **`openPrintView()`** — opens a saved document's print preview the way a real user does:
  clicks the form's own Print icon in the sidebar (`.form-sidebar .form-print .icon-btn`,
  verified against `form_sidebar.js`'s `setup_print()`, which wires it to `frm.print_doc()` →
  `frappe.set_route("print", doctype, name)` — a same-tab SPA route change, no dialog). **Live-DOM
  check caught a real selector bug**: the button's actual `title` attribute is EMPTY
  (`title=""`) with the real tooltip text in `data-original-title="Print"` (Bootstrap tooltip
  convention) — a `[title="Print"]` fallback selector matches nothing on a real site. Fixed to
  match `[data-original-title="Print"]` instead. **A second live-DOM bug was caught the same
  way**: the "Full Page" button lookup used `.print-preview-wrapper .btn`/`.page-head .btn`
  (Bootstrap-style), but the desk print page's whole toolbar (Full Page / PDF / Refresh /
  Print) is actually the same espresso (`es-*`) component used everywhere else in the current
  desk — the real markup is `<button class="es-button ellipsis">Full Page</button>` with no
  `.btn`/`.print-preview-wrapper` ancestor at all. The old selector matched nothing, which
  surfaced as a render failing with `"Full Page" button not found` even though the button was
  plainly visible in the captured frame right before the failure — confirmed by rendering a
  real flow against a live site, not by reading source. Fixed to match any `.es-button` whose
  text is exactly "Full Page". Lands on
  the desk print page, then glides to and clicks its real **"Full Page"** button, which opens
  `/printview?...` in a genuinely NEW tab (caught via `context.waitForEvent("page")`). Returns
  that new `Page` so the caller can keep rendering frames from it or close it. This replaces
  jumping straight to `/printview?...` with a cold `gotoApp` — the direct URL still works and is
  documented below for when a bare preview is genuinely what the storyboard needs, but
  `openPrintView()` is the "a person is using the app" version and should be preferred.
- **`switchListView(viewLabel)`** — switches a list view between List/Report/Dashboard/Gantt/
  Kanban/Calendar the way a real user does: clicks the view-switcher button
  (`.view-switcher .es-button`, top-right of a list view) and picks a row from the `.es-menu`
  panel it opens by visible text. Verified directly against a LIVE site's rendered DOM (current
  Frappe desk uses a newer "espresso"/`es-*` component system for this dropdown, not classic
  Bootstrap markup) — which rows appear is conditional on the doctype (Report/Calendar/Kanban
  only show if the doctype supports them).
- **`toggleListFilter()`** — opens the list view's own "Filter" control. Verified live: this is
  a standalone always-visible button, `.filter-selector .filter-button`, **separate from the
  "..." more-actions menu** (do not go looking for it there). Opens a real Bootstrap popover,
  `.filter-popover.popover .filter-edit-area` — the actual filter-field/operator/value pick
  inside it is doctype-specific, so this primitive only gets the popover on screen; drive the
  fields inside it the same way any other control is driven.
- **`clearListFilters()`** — clears every standard-filter field on a list view via its real
  "clear filters" (X) button, `.filter-x-button` (verified live, next to the Filter control).
  **Exists because of a real, confirmed hazard**: Frappe list views persist the LAST-USED
  standard filter values per doctype per user across the WHOLE SESSION
  (`frappe.get_user_settings`/`view_user_settings` in `list_view.js`) — not a harness bug, real
  documented Frappe behavior. Confirmed directly while recording a Loan demo: a `loan_disbursement`
  standard filter left over on the "Loan Repayment Schedule" list from browsing Loan Disbursement
  earlier in the SAME run silently zeroed out the list's rows, and `clickListRow(0)` then threw
  "no list row at index 0" for a reason that had nothing to do with the row-open logic — the
  list was just filtered to nothing. **Call `clearListFilters()` before relying on a list's
  default (unfiltered, newest-first) row order whenever the same run has touched a related
  doctype earlier** — e.g. right after `searchAndOpenDoctype("Loan Repayment Schedule")` in a
  flow that already created a Loan/Loan Disbursement earlier in the same storyboard.
  `clickListRow()`'s own "no list row" error now checks for `.filter-x-button` and names this
  exact possibility in its message when relevant, rather than reading like a bare selector bug.
- **Prefer `clickDashboardLink(doctypeLabel)` over `searchAndOpenDoctype` + manual filtering for
  navigating FROM a document to something it already links to.** Every Frappe doctype dashboard
  (the "Connections" tab's `.document-link` widgets, each showing a linked doctype and a badge
  count — e.g. "Loan Repayment Schedule  1" on a Loan Disbursement) is a real, generic navigation
  surface: clicking a badge link navigates straight to the linked list ALREADY filtered correctly
  by the relationship — confirmed live: clicking "Loan Repayment Schedule" on a Loan Disbursement
  lands on `.../loan-repayment-schedule/view/list?loan_disbursement=<name>`, no typing or
  clearing a filter needed. This is both more realistic (a user who just submitted a Loan
  Disbursement looks at ITS dashboard next, not the global search) and sidesteps the
  stray-filter hazard `clearListFilters()` exists for entirely. Not every doctype has a
  dashboard and not every navigation should go through one — only use it for a doctype the
  CURRENT document's own dashboard actually links to; reach for `searchAndOpenDoctype`/
  `searchAndCreateNew` for anything else. `clickDashboardLink` handles switching to the
  Connections tab itself if it isn't already active.
  **A reload between a save and a submit can leave the dashboard rendered TWICE —
  confirmed live, a real bug, not hypothetical.** A fresh page load showed exactly ONE
  `.document-link[data-doctype="Loan Repayment Schedule"]`; after this harness's own
  `saveForm()` → `submitForm()` sequence on the SAME document, the identical selector matched
  TWO — both visible, the first one stale. `frappe.ui.form.Dashboard` guards its own render
  with a `data_rendered` flag specifically to prevent this, but that flag lives on the JS
  object instance; if a reload constructs a new `Dashboard` instance without disposing the old
  one's DOM, the guard does nothing about markup already in the page. A naive "first visible
  match" (the same fix `rectOf()` uses for the hidden-duplicate hazard) picks the WRONG one
  here — Frappe always appends, so the current, live render is the LAST match, never the
  first. `clickDashboardLink` resolves this itself (picks the last visible match, tags it, and
  clicks that exact element rather than re-resolving the selector) — don't "fix" it back to a
  first-match lookup; that's the regression this fix exists to prevent.
- **`newDoc()`'s step handler used to skip the real "+ Add <Doctype>" button after landing on a
  list — a real, confirmed bug caught only by watching a render.** The automatic opening beat
  (Home → search → land on the doctype's list, documented above) correctly showed the list with
  its own "+ Add" button on screen, but then jumped straight to `/new` via a bare URL instead of
  clicking the button the viewer just saw — reads as the video silently skipping a step, not a
  person using the app. Fixed with a new `clickListAddButton(dt)` primitive (clicks the real
  `.page-head .primary-action` button) — the FIRST `newDoc()` call for a doctype in a run now
  uses it; a SECOND `newDoc()` call for an already-visited doctype still uses the direct URL
  jump, correctly, since by then the previous step has usually left off somewhere that isn't a
  list view at all (there's no "+ Add" button on screen to click).
- **`saveForm()`/`submitForm()` used to fake the click entirely — a real, confirmed bug, not a
  cosmetic nitpick.** Both functions glided to and rippled near the real Save/Submit button for
  show, but the ACTUAL action was a separate, invisible `fEval("cur_frm.save()")` /
  `cur_frm.savesubmit()` call with no real click behind it at all — the ripple and the save/
  submit were two disconnected things that happened to be near each other on screen. On camera
  this reads as the confirm dialog or "Saved" toast appearing for no visible reason, since the
  thing that actually caused it was never clicked. Fixed: both now call `clickVisible()` on the
  real `.page-head .primary-action` button and let FRAPPE'S OWN click handler fire
  `cur_frm.save()`/`savesubmit()` — no `fEval("cur_frm.save()"/...)` call anywhere in either
  function anymore. `saveForm()` detects a validation-dialog failure by polling for either "form
  clean" or "a modal appeared" (there's no promise reference to await now that the real click
  triggers it, so the old short-timeout-then-catch pattern isn't needed either). **A doctype's
  single "+Add"/primary-action button is literally "Save" on an unsaved doc and only becomes
  "Submit" after the first successful save** — always call `saveForm()` before `submitForm()`
  as two separate steps for a submittable doctype; calling `submitForm()` directly on a NEW,
  never-saved doc just clicks "Save" (correctly — that's what the button says at that point) and
  then times out waiting for a submit-confirm modal that was never going to appear.
- **`rectOf()`/every click primitive could silently target a HIDDEN duplicate of the real
  element — a real, confirmed bug found while fixing the above.** `document.querySelector(sel)`
  always returns the FIRST match in DOCUMENT ORDER, regardless of visibility. Confirmed live:
  right after a search-driven list navigation, TWO `.page-head .primary-action` buttons existed
  simultaneously — a hidden leftover from the previous screen's toolbar (`class="...
  primary-action hide"`) and the real, visible "Add Loan" button — and the hidden one happened
  to come first in the DOM, so `rectOf` (correctly) reported no visible button at all even
  though one was plainly on screen. Fixed generically: `rectOf()` now scans ALL matches for
  `sel` and returns the first one that's actually visible (non-zero `getBoundingClientRect()`),
  not just the first match found; a new shared `clickVisible(sel)` helper does the same scan
  before clicking, and EVERY raw `document.querySelector(s)?.click()` call site in the harness
  (15 of them) now goes through it instead of a bare querySelector — any of them could have hit
  the identical hazard, not just the one that happened to be caught.
- **The typing-cursor's rest position was moved again — a second user-reported regression, not
  a fresh discovery.** Parked just below the field's bottom-left (the first fix, to stop it
  covering the typed text) read as "floating, disconnected from the input" on camera instead of
  looking like a hand that just finished typing there. Moved to just past the field's RIGHT edge,
  vertically centered on it — still never overlaps the text (the arrow's hotspot renders at
  almost exactly its own x,y), but reads as "resting right where typing ended," the natural
  place a cursor sits after filling a single-line field. If this needs to move again, treat it
  as settled only once confirmed by an actual rendered frame, not reasoning about it in the
  abstract — two different "obviously fine" positions have each turned out wrong on screen.
- **`clickGroupItem(group, label)` drives a grouped button (e.g. the `Create`/`Status` dropdown
  on a submitted document's page-head, or any `frm.add_custom_button(label, fn, group)`
  grouping) — but its item-matching had to be fixed after LIVE-DOM verification exposed a real
  bug.** The dropdown's HIDDEN backing store (`.inner-group-button[data-label="<group>"]
  .dropdown-menu a[data-label="..."]`) does carry a matchable `data-label` — but that store is
  never the visible, clickable element. Opening the group button builds a SEPARATE, freshly
  rendered `.es-menu` panel from that store's current contents, and its rows carry NO
  `data-label` or any other matchable attribute — only rendered text (first letter split into
  its own `.es-menu__mnemonic` span, so match on the whole item's `textContent`, not a single
  child node). The previous version of this function queried the hidden store's selector even
  after the menu was open, which silently matched zero elements — not a hypothetical risk, a
  confirmed bug caught only by inspecting a live site's actual rendered DOM, not by reading
  source alone. Fixed to find the open, on-screen `.es-menu` and match its `.es-menu__item`
  rows by text.
- **`searchAndOpenDoctype(dt)` / `searchAndCreateNew(dt)`** — moves between doctypes through the
  REAL navbar global search ("AwesomeBar"), not a cold `gotoApp` straight to a list/new-doc URL.
  Verified against current Frappe source (`awesome_bar.js`/`search_utils.js`): the search
  trigger is `.navbar-modal-search-mobile` (or `.search-widget-wrapper #search-widget-button` on
  the desktop home, with Ctrl/Cmd+K as a fallback), opening a real `#navbar-search` input whose
  typed text drives a genuine `.awesomplete li` dropdown — typed character-by-character via
  `typeIntoSearch()`, same typing-effect rule as any other text field. Typing a bare doctype name
  surfaces a result that routes to its list view (`searchAndOpenDoctype`); typing **`new
  <doctype>`** surfaces a literal **`New <Doctype>`** result (confirmed exact label — it is
  **not** "Create a new...") that calls `frappe.new_doc()` when selected (`searchAndCreateNew`).
  If that quick-create row doesn't appear (some doctypes are excluded by permission or naming
  collision), it falls back to searching the bare doctype name to its list and clicking the
  list view's own primary "+ Add" button — still real UI, just the list-view path instead of the
  awesome-bar shortcut. **Prefer these over `newDoc()`'s direct `/app/<doctype>/new` navigation**
  whenever the storyboard beat is "switching to a different doctype" (e.g. Lead → Opportunity →
  Customer → Sales Order) — jumping by URL between doctypes reads as a developer hitting routes,
  not a person navigating the app. `newDoc()` remains fine for the FIRST doctype of a run, where
  there's no prior screen to search from.

### Data masking
- Call `maskSelectors([...css selectors])` right after sensitive content (real emails,
  server URLs, client/company names, financial totals) is on screen and BEFORE any
  `hold()`/`cap()` of that frame — it applies a CSS `blur()` directly inside the app iframe,
  so the blur is baked into every captured frame rather than a post-process overlay that
  could be misaligned or skipped. `unmaskSelectors(...)` reverses it if a later beat needs
  the real value visible again. Always mask real client data before rendering a take that
  will be shared outside the team — this is not optional cosmetic polish.

### The "Screen Studio" look = an iframe stage page
- Render the app inside an `<iframe>` on a **stage page you control**: wallpaper gradient +
  rounded window + macOS traffic-light titlebar. The window is never scaled — the frame is
  a fixed, steady 1:1 view of the app.
- **No zoom.** There is deliberately no zoom primitive: a moving scale makes text resample
  every frame and reads as motion sickness on a long walkthrough. Emphasis comes from where
  the cursor travels and how long you `hold(...)` on a settled state. Author those in `run()`.
- **`VIEW.width` must stay comfortably above Frappe's form-sidebar collapse breakpoints
  (991px, and Bootstrap's `xl` ~1200px) AFTER the stage's wallpaper margin eats into it.**
  `#win` sits at `left:3%; right:3%`, so the app iframe only gets ~94% of `VIEW.width`, not
  all of it. A narrow viewport (e.g. the old default of 1280px, leaving only ~1203px for the
  iframe) pushes the app below the breakpoint and the right-hand form sidebar
  (Assign/Attachments/Tags/Share — 277px per `form_sidebar.scss`) gets squeezed or hidden,
  clipping real content out of the recording — not a cosmetic issue. Use `VIEW = {width:
  1600, height: 900}` (iframe ≈1504px) or wider; verify by reading a frame of any doctype
  form and confirming the sidebar is fully visible, not just the Item worked example.
- Serve the stage **same-origin** via `page.route("**/__stage", r => r.fulfill({html}))`, then
  `page.goto(BASE + "/__stage")`. Same origin ⇒ the app iframe is allowed (Frappe sets no
  frame-blocking headers, but the iframe must be same-origin).
- Chrome blocks a route-fulfilled page from framing localhost with
  `ERR_BLOCKED_BY_LOCAL_NETWORK_ACCESS_CHECKS`. Launch with:
  `--disable-web-security --disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessChecks,IsolateOrigins,site-per-process`
- Run headless.

### Driving the app (CRITICAL)
- **The cursor is cosmetic only.** Do every REAL interaction via in-frame JS, never a
  Playwright real click — the visual cursor is a decoration drawn at coordinates you choose,
  and a `locator.click()` races the animation loop instead of landing between frames.
- Get the app frame with `page.frame("app")` and use `frame.evaluate(...)` / `frame.goto(...)`.
- Position the visual cursor with the injected `__setCursor(x,y)` using the element's **in-frame**
  `getBoundingClientRect()` coords; the glide tween interpolates from the last position. Trigger
  `__setRing` for the ripple; THEN perform the action in JS.
- **The cursor-install script (`INIT`) re-creates destructively WHEN IT ACTUALLY RUNS, but
  first checks whether a live install already exists before deciding to run at all.** Two
  separate defects shaped this, and both fixes must stay:
  - *"Multiple cursors visible in the video"* (original defect): a plain "does `#demo-cursor`
    exist?" check could miss a STALE set — Frappe's desk tears down and rebuilds large DOM
    subtrees on some route/refresh transitions without a real page navigation (so
    `addInitScript` doesn't naturally re-run), and if that rebuild re-parents or detaches the
    cursor nodes while `window.__setCursor` etc. still point at them, a naive existence check
    sees "yes, `#demo-cursor` exists" and skips reinstalling — but the live `__setCursor`
    closure moves a DIFFERENT, now-detached node while a second, visually-stuck set remains
    painted. Fix: when install DOES decide to rebuild, it clears every `.__demo-overlay` node
    first (`querySelectorAll`, not a single `getElementById`), never just appends alongside
    a possibly-stale set.
  - *"Cursor blinks too much"* (later defect): the 400ms safety poll used to call that
    destructive rebuild unconditionally on EVERY tick, even when the existing nodes were
    still perfectly attached and live — tearing down and recreating three DOM nodes 2.5×/sec
    reads on camera as a constant flicker even while the cursor sits idle. Fix: `install()`
    now checks `document.body.contains(...)` on all three existing overlay nodes (and that
    `window.__setCursor` is still bound) and returns immediately, doing NOTHING, when they're
    all genuinely still live — only a genuinely missing/detached node pays for the destructive
    rebuild. This is a liveness check (`document.contains`), not the naive existence check the
    first defect warns against — it still cannot be fooled by a stale, re-parented node, because
    a re-parented node has in fact been removed from `document.body`'s subtree it's checked
    against (Frappe's rebuilds replace/empty containers, they don't silently move the cursor
    overlay to float detached-but-still-in-the-light-DOM — verified by the fix actually
    resolving the flicker without the multi-cursor bug returning). Do not revert this to an
    unconditional rebuild on every poll tick "to be safe" — that's exactly the blinking defect.
  - The install script also re-runs on Frappe's own `page-change` event (fired by
    `frappe.router` on every `set_route`), not just the poll interval, so a rebuilt page gets a
    single fresh cursor sooner than waiting out the next 400ms tick.
- **A page/tab switch (e.g. opening the print preview's "Full Page" button in a new tab)
  must re-point BOTH `page` and `cdp` to the new tab, and should close or stop driving the
  old one.** The old tab's document keeps its own live cursor and its own init-script poll
  running in the background if left open; reassigning the module-level `page` variable to
  the new tab (and calling `context.newCDPSession(page)` again) is necessary but was, in an
  earlier version, not paired with closing the old tab — leaving an orphaned page that no
  longer receives captures but still exists in the context. Close the old tab once you're
  done with it unless the storyboard genuinely needs to switch back to it later.
- **`F()` must fall back to the page itself when there's no "app" iframe.** `F = () =>
  page.frame("app")` is correct for the stage page, but a tab opened via `openPrintView()`'s
  "Full Page" button is a bare standalone page — no stage shell, no "app" iframe at all —
  so `page.frame("app")` there returns `null`, and every primitive's `F().evaluate(...)`
  call throws `Cannot read properties of null`. Confirmed as a real bug (not hypothetical)
  while recording a real flow: the render crashed on the very next step after the new tab
  opened successfully. Fixed: `F = () => page.frame("app") || page`.
- **Closing the "Full Page" tab does NOT by itself return the main page to the document
  form — the next form-only action can fail with no obvious reason why.** `frm.print_doc()`
  (the print ICON's own click handler) already does a same-tab SPA route change to the desk
  print page BEFORE the "Full Page" button even opens a new tab — so switching `page` back
  to the main tab after closing the extra one leaves its app iframe still showing the PRINT
  route, not the form. A caller that then calls `clickGroupItem`/`clickCustomButton`/
  `saveForm` etc. right after closing the tab hits "button group not found" (or similar) for
  a reason that has nothing to do with the button itself — the iframe is just on the wrong
  page. Confirmed as a real failure while recording a real Loan demo (a "Create" button
  group genuinely exists on a submitted Loan, verified directly, but the step failed anyway
  immediately after a print-preview beat). Fixed generically: `openPrintView()` now records
  the form's URL (`lastFormUrl`) before navigating away from it, and `run-flow.mjs`'s
  `closeExtraTab` step navigates the app iframe back there after closing the tab and
  switching back. If you're hand-writing `run()` in a copied `reference-demo.mjs` instead of
  using `run-flow.mjs`, do the equivalent yourself: capture the form URL before calling
  `openPrintView()`, and `F().goto(that URL, ...)` after you're done with the new tab.
- **Waiting on just `window.frappe && frappe.boot` after that `goto` is NOT enough — it
  resolves long before the form itself has actually rendered.** `frappe.boot` existing only
  proves the Frappe app FRAMEWORK loaded; `cur_frm` being bound and the form's own DOM
  (`.form-layout`) existing is the real readiness signal, which is exactly what `waitForm()`
  already checks for every other form-landing primitive. The first version of the
  `closeExtraTab` fix above used the weaker `frappe.boot` check and still failed — the very
  next step (`clickGroupItem`) measured a still-blank page and failed with "button group not
  found" again, for a second, DIFFERENT reason than the one just fixed. Confirmed directly:
  the frame captured right before that second failure was genuinely blank white on screen,
  not a selector problem. Fixed by waiting on `cur_frm && cur_frm.doc &&
  document.querySelector(".form-layout")` instead — the same condition `waitForm()` uses.
  **Lesson for any new code that navigates `F()` and then needs the destination to be a
  ready Frappe FORM (not just a loaded Frappe app)**: always wait on this real signal, never
  on `frappe.boot` alone — it is a necessary but nowhere-near-sufficient condition.

### Frappe specifics
- **The doctype Dashboard (Connections tab) is a generic, built-in navigation surface worth
  understanding, not a Loan-specific or Sales-Order-specific thing.** Every Frappe doctype can
  declare, in its controller's `get_dashboard_data()` (Python) or implicitly via its linked
  doctypes, a set of OTHER doctypes that link back to it. The desk renders these on the
  "Connections" tab as `.document-link` widgets — a doctype name plus a badge showing how many
  such documents exist, e.g. "Loan Repayment Schedule  1" on a Loan Disbursement, or "Sales
  Invoice  3" on a Sales Order. Clicking a badge (`.badge-link` inside `.document-link-badge`)
  navigates to that doctype's list, PRE-FILTERED by the correct relationship via URL query
  params — Frappe builds that filter itself from the actual link field, so it's always correct
  and never needs typing or clearing. This skill's `clickDashboardLink(doctypeLabel)` primitive
  drives exactly this. Use it (not `searchAndOpenDoctype` + manual filtering) whenever the
  storyboard is moving from a document to something that document's own dashboard already
  shows a link for — it's both more realistic (that's how a real user actually finds related
  records) and avoids the stray-filter hazard documented under `clearListFilters()`. It is NOT
  the right tool for every navigation — most doctype switches in a flow (e.g. Lead → Opportunity
  in a CRM flow where Opportunity doesn't trivially show up on Lead's own dashboard in a useful
  way) are still better served by `searchAndCreateNew`/`searchAndOpenDoctype`. Check what a
  document's dashboard actually shows (open it once, click Connections) before assuming a link
  exists — `clickDashboardLink` throws a clear error naming the doctype if it doesn't find one.
- **Checkboxes:** `cur_frm.set_value(fieldname, 1)` — a native `input.click()` does NOT
  register with Frappe. The control re-renders checked, so the viewer sees it toggle.
- **Tabs:** `clickTab(label, anchor)` glides to the nav-link, ripples, AND clicks it itself —
  it does not just perform the cosmetic motion and leave the real switch to `anchor`. (An
  earlier version only glided/rippled and relied entirely on the later `revealField(anchor)`
  call to perform the actual `.click()`; calling `clickTab(label)` with no anchor, or one that
  turned out hidden, silently left the pane never switching. Fixed — always click here too.)
  **A second, related bug**: the glide/ripple/click were all nested inside `if (r) { ... }`,
  where `r` is the tab's measured rect — so if `rectOfTabLabel` returned `null` (confirmed live:
  right after `submitForm()`'s docstatus flip re-renders the page-head, the tab strip can
  briefly not have the target tab mounted yet when `clickTab` is called immediately after), the
  ENTIRE block — including the real `.click()` — was skipped, with nothing to show for it on
  camera and no error either. Fixed: `clickTab` now waits for the tab to actually be in the
  strip before measuring, and clicks it UNCONDITIONALLY afterward regardless of whether the
  cosmetic glide/ripple ran — a missing ripple is a cosmetic gap, a missing click silently
  breaks every caller downstream of it (this is what made `clickDashboardLink`'s "Connections"
  tab switch fail with no visible cause while recording a real Loan Disbursement flow).
  `revealField(fn)` does its OWN independent tab-activation too (belt-and-suspenders, not a
  dependency on `clickTab`): it does NOT use `scroll_to_field` (that call also does an instant,
  uncaptured `scrollIntoView` as a side effect — the "scroll is missing" bug this skill exists
  to fix). Instead it finds the field's `.tab-pane` ancestor directly and clicks the matching
  `.form-tabs .nav-link[href="#<tab-pane-id>"]`, THEN drives the scroll itself via `scrollToSel`
  (captured, frame-by-frame). Always pair a tab switch with an explicit `scrollToSel`/
  `revealField` call; never rely on `scroll_to_field` alone to both reveal and scroll.
- **Collapsed sections:** opening the tab does NOT open a collapsed section inside it, so a
  field inside one is still invisible and `getBoundingClientRect()` returns zeros. `revealField`
  handles this: it finds the field's `.form-section`, clicks `.section-head.collapsed` inside
  it if present, waits for the reflow, THEN measures/scrolls. `rectOf` returns `null` for a
  zero-size element so a glide to a still-hidden target (e.g. a field gated by `depends_on`
  that genuinely isn't shown) is skipped rather than aimed at 0,0.
- **Custom buttons** render into `.custom-actions` with a **URI-encoded `data-label`**, so
  address them by attribute rather than matching text:
  `.custom-actions [data-label="<Button%20Label>"]`. A grouped button is
  `.inner-group-button[data-label="<Group%20Label>"] > button`, its items
  `... a[data-label="<Item%20Label>"]` — but see "Robustness primitives"' note on
  `clickGroupItem`: the hidden backing store carries this `data-label`, while the actually
  rendered, clickable `.es-menu` panel does not (verified live) — match its rows by text
  instead. Click the group button first — the menu's items have no measurable rect until it
  is open, so dwell on the open menu, then glide to the item.
- **Read-only Attach fields** render no control at all while empty, so a file cannot be put
  there from the UI — attach it server-side off-camera if the flow needs one.
- **Fields:** `await cur_frm.set_value(fn, val)` (works for link/date/data/currency).
- **Submit:** `cur_frm.savesubmit()` returns the confirm-dialog promise — if you `await` it
  inside `page.evaluate` it hangs forever. Fire it WITHOUT await, wait for
  `.modal.show .btn-modal-primary`, then `.click()` that button; then wait for `docstatus===1`.
- **`cur_frm.save()` ALSO never resolves or rejects on a validation failure — this is the SAME
  failure class as `savesubmit()`'s confirm dialog, not a separate hazard.** A custom
  `validate()` that calls `frappe.throw(...)` for a field that isn't even marked `reqd:1` in
  the schema (confirmed on Sales Order's `validate_delivery_date()`, which requires
  `delivery_date` with no `reqd` flag anywhere — exactly the gap `get-schema.py`'s own
  documentation warns metadata can't see) shows a "Missing Fields" dialog and leaves the
  `save()` promise permanently pending — verified directly: still pending 8+ seconds after the
  dialog was confirmed open. `saveForm()` now calls `fEval` with a SHORT timeout (6s, not the
  15s default) specifically for the save call, and on timeout checks for an open
  `.modal.show` and throws a clear error naming the dialog's title/body if one is found, rather
  than surfacing a generic "in-page timeout" that gives no clue a dialog is sitting there. If
  you hit this, the fix is almost always to set the field the dialog names in your storyboard
  BEFORE calling `saveForm()` — not to raise the timeout further.
- **Never let `page.evaluate` hang:** wrap in-page async calls so they resolve within a
  timeout (race a `setTimeout`). Also retry once on "Execution context was destroyed"
  (client-side route change races), and let a fresh `new_doc` settle before setting fields.
- **Don't load `/app` (desk home)** first — it can 500 ("error building this page"). Start the
  iframe at `about:blank` and `frame.goto(BASE + "/app/<doctype>")` straight to the target.
- **Desk routes can be workspace-scoped: `/desk/<workspace-slug>/<doctype>/<name>` is the same
  page as `/app/<doctype>/<name>`, not a different one.** Confirmed from `router.js`:
  `slug_parts` treats `"app"` and `"desk"` as interchangeable route prefixes (both get stripped
  identically before resolving the doctype/name), and `keep_shell_moved_into` builds the
  workspace-scoped form as `/desk/<shell-slug>/<rest of path>` purely to keep that workspace's
  sidebar open — it is cosmetic, not a different target. A live user on a bench with named
  workspaces (confirmed on one using a "Lending" workspace: URLs read
  `/desk/lending/item/<name>`, not `/app/item/<name>`) will see and use the `/desk/<slug>/...`
  form throughout, so a recording that only ever uses bare `/app/...` reads as slightly
  "backend-y" rather than "what a real user sees." **Keep using plain `/app/<doctype>/...` as
  the default in `gotoApp` calls** — it works on every bench, with or without named workspaces,
  and needs no workspace-slug lookup — but know that `/desk/<slug>/...` is the equivalent
  realistic form if a storyboard is deliberately mimicking a specific user's screen (e.g.
  matching a reference recording) rather than being workspace-agnostic.
- **`gotoApp` checks the HTTP response status and retries once on a 5xx.** A bare
  `frame.goto(url, {waitUntil:"domcontentloaded"})` does NOT throw on a server error — a dev
  server's transient 500 (reload race, a momentary hiccup under back-to-back navigations)
  satisfies `domcontentloaded` exactly like a real page, so an unchecked `goto` can silently
  capture the error screen as if it were content and the render finishes "successfully" with a
  broken step baked in. Observed in practice: a render's final PDF-view step came back as a
  plain `500: Uncaught Exception` page while every other step that run rendered correctly — a
  genuinely transient server-side failure, not a URL or harness bug (confirmed by reproducing
  the same request standalone immediately after, which succeeded). `gotoApp` now reads
  `res.status()` and retries once after an 800ms backoff before giving up and throwing. Always
  use `gotoApp` for in-frame navigation rather than a raw `frame.goto` for this reason.
- **`gotoApp` also waits for `frappe.boot` on any `/app/...` or `/desk/...` URL, not just HTTP
  status** (the "redirect sometimes not good" defect). `waitUntil:"domcontentloaded"` fires the
  instant the desk SHELL's DOM exists — but Frappe's desk resolves a route in TWO steps: the
  shell loads first, then `frappe.router` drives a second, in-page route to the actual view
  (list/form/print). A `goto()` that returns between those two steps can get captured
  mid-transition: a blank content pane, or briefly the PREVIOUS page's content before the new
  route's view swaps in. This is generic to every route, not specific to any one destination —
  waiting on `window.frappe && frappe.boot` (proof the desk app itself finished bootstrapping)
  after the HTTP check closes the gap for every `gotoApp` call, not just the ones whose callers
  happen to already `waitForFunction` something specific afterward. Skipped for non-desk
  URLs (`/printview`, a raw API/file response) which have no such global to wait for.
- **`newDoc(dt)` / any `frappe.*` call needs a desk page loaded first.** The iframe starts at
  `about:blank`, where `window.frappe` genuinely does not exist — calling `frappe.new_doc(...)`
  before any navigation throws `ReferenceError: frappe is not defined` (verified — this is not
  a timing/race issue, retrying does not help). Always `gotoApp(...)` to a page for the target
  doctype FIRST, THEN call `newDoc`/`setField`/etc.
  - Prefer `gotoApp("/app/<doctype>/new")` over navigating to the list view and clicking
    "+ Add": `/<doctype>/new` is Frappe's own generic route for a fresh document — the router
    treats any doc name starting with the literal string `"new"` as a signal to call
    `frappe.model.make_new_doc_and_get_name()` (see `formview.js`'s `render_new_doc`), the same
    function `frappe.new_doc()` itself drives. It is not a doctype-specific convenience route;
    it works identically for every doctype in every module, and it also doubles as exactly what
    a real user sees right after clicking "+ Add".
- **Reports:** filters default to the browser's current month/year. Wait until
  `frappe.query_report.filters` is a non-empty array before `set_filter_value(...)` +
  `refresh()`; make it best-effort (defaults often already correct).
- **Opening a document from its list view** (e.g. "go back to the list, scroll it, click any
  row"): the row's actual navigation target is `.list-row .list-subject a` — confirmed from
  `list_view.js`'s row click handler, which resolves `$row.find(".list-subject a")` and
  `frappe.set_route(link.pathname)`. This is generic to every doctype's list view (same class
  names everywhere), so glide to and click
  `document.querySelectorAll(".list-row .list-subject a")[0]` (or any index) to open "any row"
  without knowing a specific document name in advance. The list view itself scrolls the
  document (same as a form — no nested `overflow:auto` container to special-case), so
  `scrollToSel`/`scrollToY` work on it unchanged.

### Features whose buttons enqueue background jobs
- A pipeline step (`frappe.enqueue` + a poller cron) does **not** finish when clicked: the
  button returns a "started in the background" toast and the status only advances when the
  worker runs the job and the poller reads the result. Film the click and the toast, then run
  the job function and its poller **off-camera** from a small bench-python script (see
  `asyncStep`/`bench` in the reference harness). The video never waits on a 5-minute cron.
- **Do not depend on the bench's RQ worker.** A long-running worker can hold stale bytecode
  and fail every job (an `ImportError` in `logs/worker.error.log`) while the web server is
  fine — the take then stalls at a status that never advances. Driving the job inline also
  makes takes reproducible without restarting the user's bench (don't do that unasked).
- Show the status moving. Reveal the status field after each step (`Draft → Validated → …`)
  — the header chip usually shows only `docstatus`, so without this the progression that IS
  the story is invisible.

### Opening the print view on camera
- **Prefer `openPrintView()`** (see "Robustness primitives" above) for any storyboard beat that
  shows a user opening a document's print preview — it drives the REAL click chain (form's own
  Print icon → desk print page → "Full Page" button → new tab), not a cold URL jump. The notes
  below on the raw `/printview` URL remain accurate and are still the right tool when the
  storyboard genuinely wants a bare preview with no surrounding UI chrome (e.g. cutting straight
  to a print layout for a close-up), but a full "user opens the print view" beat should go
  through `openPrintView()`.
- **There is no `/app/<doctype>/<name>/print` desk route** — it 404s ("Sorry! I could not
  find what you were looking for"), verified against a live site. The real print preview is
  the standalone www page `/printview?doctype=<dt>&name=<name>&format=<print format name>`.
  Add `&trigger_print=0` so it renders the preview without firing the browser's actual print
  dialog (the real desk "Print" button omits this and passes `trigger_print=1`, which is right
  for a user printing but wrong for an on-camera preview — confirmed against
  `frappe.utils.print()` in `utils.js`). `format` can be omitted to use the doctype's default.
- Navigate the app frame straight there with `gotoApp(...)`, same as any other page; wait for
  `.print-format` to appear before capturing. This is generic to every doctype — nothing about
  it is payroll/HR-specific.
- **There IS a real desk print route, and it's a better opening beat than jumping straight to
  `/printview`.** `/app/<doctype>/print/<name>` (or the workspace-scoped
  `/desk/<workspace-slug>/print/<doctype>/<name>` — see "Desk routes can be workspace-scoped"
  below, both resolve identically) renders a genuine desk page: a left sidebar with Print
  Format / Language / Letterhead pickers, and a **Full Page / PDF / Refresh / Print** button
  row (confirmed against a live recording of a real user's flow). A real user lands here first
  — via the doc's own print icon — not on the bare `/printview` page. For a storyboard that
  should read as "a person using the app" rather than "a developer hitting an API route,"
  open THIS page, dwell on it, then glide to and click its **"Full Page"** button — which opens
  `/printview?doctype=...&name=...&format=...` in a NEW browser tab (confirmed: this is exactly
  how the plain `/printview` page above is meant to be reached, not as a cold `gotoApp`).
  - A new tab needs a new `page`/`frame` reference: listen for `context.on("page", ...)` (or
    poll `context.pages()`) after the click, grab the new page, and either keep rendering frames
    from it (re-point `cap()`/`F()` at it — note the cursor-overlay script only auto-installs in
    frames that already had `addInitScript` applied, i.e. ones opened BY this context, which a
    `context.on("page")` tab is) or close it and continue on `/printview` via `gotoApp` if a
    fresh-tab beat doesn't fit the storyboard. Either is fine; just don't silently drop the
    click as decorative — the stage will otherwise be captured mid-navigation or on a blank tab.

### Opening a PDF on camera
- Playwright's **headless shell has no PDF viewer** — it downloads the file
  ("Download is starting") instead of rendering it. Launch with `channel: "chromium"` (the
  full build, still headless) and the viewer renders inline. Navigate the app frame straight
  at the file URL; the session cookie covers `/private/files/...`.
- **The generic "Get PDF" URL for any doctype** (confirmed against
  `print_action_banner.html`): `/api/method/frappe.utils.print_format.download_pdf?doctype=
  <dt>&name=<name>&format=<print format name>`. `format` can be omitted to use the default.
  This is the same URL the desk's own "Get PDF" link uses.
- The injected cursor script survives into the viewer document, so the cursor stays visible.
  After navigating back, Node's `cx/cy` must be reset to the new document's centre or the
  next glide tweens in from the old page's coordinates — `gotoApp` does this.
- **Chromium's built-in PDF viewer cannot be scrolled by the `scrollToY`/`scrollToSel`
  primitives.** Verified: it renders in its own internal plugin frame, not a normal DOM
  document — `document.scrollingElement.scrollTop` inside the app iframe never reaches it,
  and a CDP `Input.dispatchMouseEvent` `mouseWheel` event doesn't move it either (both tested
  against a live PDF). If a flow needs a visible scroll, do it on the plain `/printview` HTML
  page (a real scrollable document, drives correctly) rather than the PDF — the PDF step is
  for proving the file opens/renders inline, not for a scroll demo. Also: many single-doctype
  PDFs (e.g. a short master record like Item) render as exactly one page, so there would be
  nothing to scroll even if the viewer could be driven — check page count before planning a
  PDF-scroll beat at all.
- Generating a PDF with `frappe.utils.pdf.get_pdf` (wkhtmltopdf): it lays out against a
  **~712px viewport at 96dpi** (A4 less 10mm margins) and scales that to paper, so author at
  a fixed pixel width in **px** units and pass margins as wkhtmltopdf `options`. `pt` sizes
  and `@page` margins come out several times too large and overflow the page.

### Login off-camera
- Authenticate via `request.newContext()` → `POST /api/method/login {usr,pwd}` →
  `storageState`, then create the recording context with that `storageState`. Login never
  appears in the video.

### Reset between takes (server-side)
- Reset via **bench python** (`reset-demo.py`), NOT client-side API calls: client-side
  `frappe.client.cancel`/`delete` can't remove submitted docs with linked ledger entries, and
  `frappe.delete_doc(force=1)` still refuses submitted docs. The reliable reset for a demo test
  site is: try `doc.cancel()`, and if that raises, `frappe.db.set_value(dt, name, "docstatus", 0)`
  + commit, then `frappe.delete_doc(force=1)`. Also reset the feature's toggles to their pre-demo
  state so the "enable" steps animate on camera. Run it from `make-video.sh` before the render.
- **Reset settings with `frappe.db.set_single_value(..., update_modified=False)`, not
  `doc.save()`** — a save files a Version, and the reset then appears in the settings page's
  own Activity feed while that page is on camera.
- **Clear the previous take's history.** When a doctype's name is deterministic (a naming
  series built from the data), the new document inherits the old one's `Comment`, `Version`,
  `Activity Log` and `Document Follow` rows, and its Activity feed reads "you submitted this
  20 minutes ago" seconds after creation. Deleting the document does not remove them, and
  `File` rows attached to it also outlive it — delete all of these explicitly.
- **Seed everything the feature gates on**, not just the obvious inputs. Validation gates read
  fields nobody thinks about (a challan's tax *breakup* rather than its deposited total; the
  Address/Contact records a form pulls its address block from). Prove the flow server-side
  first — every gate you hit in the dry run is one you would otherwise hit mid-render.

### Encoding (frames → mp4)
- Encode the image sequence at a constant 60fps:
  `ffmpeg -framerate 60 -i output/frames/%06d.png -vf format=yuv420p -c:v libx264 -pix_fmt yuv420p -movflags +faststart -crf 18 -r 60 out.mp4`.
  **No `setpts`, no `minterpolate`** — every frame is a real render; author real durations in the
  storyboard instead of speeding up in post.
- **Optional motion blur:** `-vf "tblend=all_mode=average,format=yuv420p"` averages adjacent
  (already-distinct) frames — a light, artifact-free blur, unlike `minterpolate=blend` which
  ghosted a 25fps source. For stronger blur, render the storyboard at 120–240 sub-fps and collapse.
- Playwright's bundled ffmpeg (`~/Library/Caches/ms-playwright/ffmpeg-*`) is **VP8-only — no
  H.264**. Use a full ffmpeg: `brew install ffmpeg` or Screen Studio's bundled one at
  `/Applications/Screen Studio.app/Contents/Resources/app.asar.unpacked/bin/ffmpeg-darwin-arm64`.
- **Validate output with the FULL ffmpeg**, not the bundled one — the bundled build reports a
  good H.264 file as "Invalid data" because it can't decode H.264. Write to a temp file, then
  `mv` into place, so the user never opens a file mid-write.
- **Deliver the finished video to `~/Downloads`**, not just the render's working directory
  (a project folder or a `/tmp`/scratchpad copy of the assets) — that is where a user actually
  looks for a finished video, independent of where the render happened to run. `make-video.sh`
  does this automatically (`cp` to `$OUT_DIR`, default `~/Downloads`); keep that step if you
  modify the encode script, and mention the `~/Downloads` path when reporting completion.

### Process discipline
- Render/encode in the background; wait via a Monitor until-loop or the task notification.
  `sleep` in the foreground is blocked; there is no `timeout` on macOS (use script internal timeouts).
- The `.mjs` never hangs node: every in-frame call is timeout-protected, and the render fails
  loudly (non-zero exit) rather than silently.
- After each render, **extract/read frames** to verify content is correct and looks good — don't
  trust exit code 0 alone. Deliver early (a partial-flow clip proves smoothness) before the full pass.

## Working on a shared bench (gotchas)
- **A shared app's git branch is the #1 source of silent breakage.** Feature computation AND
  required doctype modules can vary by branch. A backport/hotfix branch may be missing a
  child-doctype module that a document you submit depends on (submit then fails with
  `No module named '...'`), or a regional/optional hook that computes the numbers you're
  demoing may only be registered on some branches. ALWAYS check `git -C apps/<app> branch`
  first; if results regress with no code change of yours, suspect the branch.
- **Never switch a shared bench's app branch without asking** — it may be the user's active work.
  If you must switch to record, use a trap to restore the original branch on exit (success OR
  failure), and only switch back AFTER the render finishes (the running dev server and the render
  both import the app's modules live). After switching, give the dev server a few seconds to reload.
