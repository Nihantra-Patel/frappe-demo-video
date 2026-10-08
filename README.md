# frappe-demo-video

A Claude Code skill that produces a polished, Screen-Studio-style demo video of a
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

That's it — Claude Code picks the skill up from `~/.claude/skills/frappe-demo-video/`.
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
| `assets/reference-demo.mjs` | The storyboard + reusable harness (stage, cursor, capture, form actions). Copy it and edit only `run()` |
| `assets/get-schema.py` | Lookup tool: prints a doctype's fields/types/mandatory status via `frappe.get_meta()`, so you don't read the raw doctype `.json` by hand. A planning aid, not an auto-storyboard generator — see SKILL.md's "Doctype schema lookup" section for why |
| `assets/reset-demo.py` | Server-side reset to a clean pre-demo state, run before every take |
| `assets/make-video.sh` | reset → render → encode to a constant-60fps MP4 |

The included storyboard is a worked example against an India Payroll flow. The harness above
`run()` is feature-agnostic — that's the part you keep.

## First run

1. Copy `assets/` next to wherever you want the output, and point it at your bench:

   ```bash
   export DEMO_URL=http://<site>:8000
   export DEMO_USER=Administrator
   export DEMO_PASS=<password>          # bench --site <site> set-admin-password …
   export BENCH=$HOME/frappe-bench
   export DEMO_SITE=<site>
   ```

2. Edit the demo-data constants at the top of `reference-demo.mjs` (`EMP_ID`, `STRUCTURE`,
   `COMPANY`) and the doctypes `reset-demo.py` clears, to match your site.

   Don't know the target doctype's fields offhand? `DEMO_SITE=<site> bench/env/bin/python
   assets/get-schema.py <doctype>` prints every field's name/type/mandatory status in one
   shot — a lookup to inform the storyboard you write by hand, not something that writes it
   for you (see SKILL.md if you're tempted to wire it into an auto-generator).

3. Rewrite `run()` as your storyboard, using the harness verbs:

   ```js
   await gotoApp("/app/payroll-settings");
   await waitForm("Payroll Settings");
   await clickTab("India Payroll", "enable_esic");
   await toggleCheck("enable_esic");
   await setField("esic_registration_number", "31000123450001001");
   await saveForm();
   await hold(1200);           // dwell on the settled state
   ```

   Emphasis comes from where the cursor travels, how long you `hold(...)`, and the field
   highlight + typed-text effect `setField()` already does for you — not zoom (a moving
   scale resamples text every frame and reads as motion sickness over a long walkthrough).

   Other verbs worth knowing:

   ```js
   await scrollToSel('[data-fieldname="earnings"]', 650);  // captured scroll, not a jump
   await scrollReportBody(900);                             // scroll a report's result table
   await holdIdle(1800);          // dwell with the cursor faded out (no click coming next)
   await maskSelectors([".client-email", ".ssn"]);  // blur sensitive data in every frame
   ```

4. Render:

   ```bash
   ./make-video.sh                 # reset + render + encode
   SKIP_RESET=1 ./make-video.sh    # keep current data
   SKIP_RENDER=1 ./make-video.sh   # re-encode existing frames
   BLUR=1 ./make-video.sh          # light motion blur
   ```

Output is `demo.mp4` (2560×1600, 60fps) plus the raw frames in `output/frames/`.

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
