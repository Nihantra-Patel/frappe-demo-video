# frappe-demo-video

A skill that produces a polished, Screen-Studio-style demo video of a
Frappe/ERPNext/HRMS feature — app in a rounded window on a desktop wallpaper, glide cursor,
click ripples — by driving the real app headlessly and rendering it **frame by frame**.

No screen recorder, no manual clicking, no Screen Studio licence. Re-runnable: reset the
site, re-render, get a byte-for-byte comparable take.

## Why frame-by-frame

A 25fps screen capture plus ffmpeg interpolation looks ghosty. This renders every output
frame explicitly: cursor motion is tweened in Node (one eased step per frame, CSS
transitions off), and a raw CDP `Page.captureScreenshot` grabs that exact frame. Real
interactions run in wall-clock time between beats and are not captured, so the video cuts
cleanly from before-state to after-state. 60fps out, zero interpolation.

## Install

```bash
unzip -d ~/.claude/skills/ frappe-demo-video-skill.zip
```

That's it — the skill is picked up from `~/.claude/skills/frappe-demo-video/`.
For a project-local install, use `<repo>/.claude/skills/` instead. Then just ask:

> make a demo video of <feature> in <app>

## Requirements

| | |
|---|---|
| Node | with `playwright` installed (`npm i playwright`), and its Chromium: `npx playwright install chromium` |
| ffmpeg | a full build with H.264 — `brew install ffmpeg`. Playwright's bundled ffmpeg is VP8-only and will not work |
| bench | a running Frappe bench with the target app installed, reachable over HTTP |

The render launches `channel: "chromium"` (the full Chromium build, still headless) rather
than Playwright's headless shell — the shell has no PDF viewer, so it downloads PDFs instead
of rendering them if your flow opens an attachment.

## Files

| File | What it is |
|---|---|
| `SKILL.md` | The method and the hard-won rules. Read this first — every rule in it was paid for in debugging |
| `assets/run-flow.mjs` | **The recommended way to make a new video.** A generic runner: describe the flow as a plain JSON step list (`steps.json`) and it replays that list using the same deterministic harness — no `.mjs` file to write or edit at all |
| `assets/reference-demo.mjs` | The harness (stage, cursor, capture, form actions) plus a worked-example `run()` shape. Copy it and edit only `run()` ONLY for a flow that genuinely needs custom JS a plain step list can't express |
| `assets/get-schema.py` | Lookup tool: prints a doctype's fields/types/mandatory status via `frappe.get_meta()`, so you don't read the raw doctype `.json` by hand. A planning aid, not an auto-storyboard generator — see SKILL.md's "Doctype schema lookup" section for why |
| `assets/reset-demo.py` | Worked-example server-side reset for the `reference-demo.mjs` path. Not needed with `run-flow.mjs` — it resets generically via `--reset-only`, tracking whatever each run actually created |
| `assets/make-video.sh` | reset → render → encode to a constant-60fps MP4. Picks `run-flow.mjs` + a `steps.json` automatically if present; pass `SCRIPT=<file>.mjs` to use a bespoke storyboard instead |

Everything here is generic — no file is specific to one doctype, module, or app. Any example
doctype/field names you see (in `reference-demo.mjs`'s `run()` or `reset-demo.py`) are
placeholders (`<Doctype>`, `<fieldname>`) meant to be replaced, not a real feature.

## First run — the generic path (recommended)

1. Copy `assets/` next to wherever you want the output, and point it at your bench:

   ```bash
   export DEMO_URL=http://<site>:8000
   export DEMO_USER=Administrator
   export DEMO_PASS=<password>          # bench --site <site> set-admin-password …
   export BENCH=$HOME/frappe-bench
   export DEMO_SITE=<site>
   export DEMO_TITLE="<App Name>"       # optional — the cosmetic window titlebar text
   ```

2. Don't know the target doctype's fields offhand? `DEMO_SITE=<site> bench/env/bin/python
   assets/get-schema.py <doctype>` prints every field's name/type/mandatory status in one
   shot — a lookup to inform the flow you describe, not something that writes it for you
   (see SKILL.md if you're tempted to wire it into an auto-generator).

3. Write `steps.json` — an ordered list of `{action: input}` steps, one per beat of the flow,
   using the harness's own verbs. Nothing is required or assumed; only include what the flow
   actually needs:

   ```json
   [
     {"newDoc": "<Doctype>"},
     {"setField": {"<fieldname>": "<value>"}},
     {"saveForm": true},
     {"openPrintView": true},
     {"closeExtraTab": true},
     {"backToListView": true}
   ]
   ```

   The opening beat (Home → real navbar search → the doctype's list) happens automatically the
   first time a flow visits a doctype — you don't write it yourself. A later step can reference
   an earlier one's generated document name with `"{{Doctype.N}}"` (the Nth document of that
   doctype created so far). See `run-flow.mjs`'s own header comment for the full list of
   actions and their exact input shape (`setFrappeLinkField`, `ensureGridRow`, `clickTab`,
   `switchListView`, `toggleListFilter`, `runReport`, `maskSelectors`, and more).

4. Render:

   ```bash
   STEPS=steps.json ./make-video.sh      # reset + render + encode
   SKIP_RESET=1 ./make-video.sh          # keep current data
   SKIP_RENDER=1 ./make-video.sh         # re-encode existing frames
   BLUR=1 ./make-video.sh                # light motion blur
   ```

Output is `demo.mp4` (2560×1600, 60fps) plus the raw frames in `output/frames/`. Every document
the run creates is tracked in `output/created-docs.json` and deleted generically before the
next take — no reset script to hand-write for this path.

## When you still need a hand-written `.mjs` storyboard

Only for a flow that genuinely needs custom JS logic a plain step list can't express —
conditional branching on a value read mid-flow, a loop over a dynamic list, or a bespoke
off-camera `bench()` step wired into the storyboard's own timing. For that case:

1. Copy `reference-demo.mjs` and rewrite `run()` as your storyboard, using the same harness
   verbs `run-flow.mjs`'s steps map onto:

   ```js
   await newDoc("<Doctype>");
   await setField("<fieldname>", "<value>");
   await saveForm();
   await hold(1200);           // dwell on the settled state
   ```

   Emphasis comes from where the cursor travels, how long you `hold(...)`, and the field
   highlight + typed-text effect `setField()` already does for you — not zoom (a moving
   scale resamples text every frame and reads as motion sickness over a long walkthrough).

   Other verbs worth knowing:

   ```js
   await scrollToSel('[data-fieldname="<fieldname>"]', 650);  // captured scroll, not a jump
   await scrollReportBody(900);                                // scroll a report's result table
   await holdIdle(1800);          // dwell with the cursor faded out (no click coming next)
   await maskSelectors([".client-email", ".ssn"]);  // blur sensitive data in every frame
   ```

2. Write/adapt `reset-demo.py` (replace its `<Doctype>`/`<fieldname>` placeholders) and run
   `SCRIPT=your-script.mjs ./make-video.sh`.

## Two things that will save you an hour

- **Prove the flow server-side before you render.** Run the feature end to end in bench
  python first. Validation gates read fields nobody thinks about, and every gate you hit in
  a dry run is one you would otherwise hit halfway through a render.
- **Check the app's git branch.** Feature code and even required doctype modules differ
  across branches; a backport branch can be missing something the flow needs. If results
  regress with no change of yours, suspect the branch — and don't switch a shared bench's
  branch without asking.

## Reviewing a take

Read frames, don't just trust exit code 0:

```bash
open output/frames/002500.png
```

Look for: stale Activity-feed entries from the previous take, a settings reset showing up
on camera, dimmed modal backdrops in the closing shot, and status fields that never visibly
change. `SKILL.md` covers the fix for each.
