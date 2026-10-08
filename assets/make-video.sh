#!/usr/bin/env bash
# Renders the demo to a constant-60fps MP4 from a deterministic PNG frame
# sequence (output/frames/%06d.png). No real-time capture, no setpts/minterpolate
# — every frame is a real render, so motion is genuinely smooth. Usage: ./make-video.sh
#   STEPS=<file>   a plain-language flow file for the GENERIC run-flow.mjs runner
#                  (default: steps.json in this directory, if it exists) — the
#                  recommended path for a new video: describe the flow as a JSON
#                  step list (see run-flow.mjs's own header comment for the
#                  format) instead of writing/editing a .mjs storyboard script.
#   SCRIPT=<file>  a bespoke .mjs storyboard to run INSTEAD of run-flow.mjs, for
#                  the rare flow a plain step list can't express (a scenario
#                  needing custom JS logic, not just a sequence of UI actions).
#                  If neither STEPS nor SCRIPT is given and a steps.json exists
#                  in this directory, it's used automatically.
#   BENCH=<path>   bench directory (default: $HOME/frappe-bench)
#   OUT_MP4=<file> output filename (default: demo.mp4)
#   OUT_DIR=<dir>  where the final video is copied/delivered (default: ~/Downloads —
#                  this is where the user actually looks for a finished video; the
#                  render's own working copy still lands in this script's directory)
#   SKIP_RENDER=1  reuse existing frames (skip the node render)
#   SKIP_RESET=1   skip the generic/server-side reset step
#   BLUR=1         add subtle motion blur (tblend average of adjacent frames)
set -euo pipefail
cd "$(dirname "$0")"
SCRIPT_DIR="$(pwd)"

# Playwright's bundled ffmpeg is webm-only; use a full ffmpeg for H.264/MP4.
SS_FFMPEG="/Applications/Screen Studio.app/Contents/Resources/app.asar.unpacked/bin/ffmpeg-darwin-arm64"
if command -v ffmpeg >/dev/null 2>&1; then FFMPEG="ffmpeg";
elif [ -x "$SS_FFMPEG" ]; then FFMPEG="$SS_FFMPEG";
else echo "No full ffmpeg found (need H.264). Install with: brew install ffmpeg"; exit 1; fi
OUT_MP4="${OUT_MP4:-demo.mp4}"
BENCH="${BENCH:-$HOME/frappe-bench}"
STEPS="${STEPS:-}"
SCRIPT="${SCRIPT:-}"
if [ -z "$STEPS" ] && [ -z "$SCRIPT" ] && [ -f "$SCRIPT_DIR/steps.json" ]; then
  STEPS="$SCRIPT_DIR/steps.json"
fi

if [ "${SKIP_RENDER:-0}" != "1" ]; then
  if [ -n "$SCRIPT" ]; then
    # Bespoke storyboard path (reference-demo.mjs copied/edited for a flow a
    # plain step list can't express) does its OWN reset via reset-demo.py, the
    # way every such script has always worked — kept for that rare case.
    if [ "${SKIP_RESET:-0}" != "1" ] && [ -f "$SCRIPT_DIR/reset-demo.py" ]; then
      echo "▶ Resetting demo data (server-side, clean pre-demo state)…"
      ( cd "$BENCH/sites" && "$BENCH/env/bin/python" "$SCRIPT_DIR/reset-demo.py" )
    fi
    echo "▶ Rendering frames (headless Playwright, deterministic)…"
    node "$SCRIPT"
  elif [ -n "$STEPS" ]; then
    # Generic path (recommended default): a plain JSON step list replayed by
    # run-flow.mjs — no per-project script to write at all. Its own --reset-only
    # mode (deleting whatever the PREVIOUS run's created-docs.json recorded) is
    # the reset step here, not reset-demo.py — there is nothing to hand-write.
    if [ "${SKIP_RESET:-0}" != "1" ] && [ -f "$SCRIPT_DIR/output/created-docs.json" ]; then
      echo "▶ Resetting demo data from the previous run's created-docs.json…"
      node "$SCRIPT_DIR/run-flow.mjs" "$STEPS" --reset-only
    fi
    echo "▶ Rendering frames (headless Playwright, deterministic)…"
    node "$SCRIPT_DIR/run-flow.mjs" "$STEPS"
  else
    echo "✗ Nothing to render: pass STEPS=<file.json> (generic flow) or SCRIPT=<file.mjs> (bespoke storyboard), or put a steps.json in this directory."
    exit 1
  fi
fi

N=$(ls output/frames/*.png 2>/dev/null | wc -l | tr -d ' ')
if [ "$N" -lt 2 ]; then echo "✗ No frames in output/frames/"; exit 1; fi
echo "▶ Encoding $N frames → $OUT_MP4 (constant 60fps${BLUR:+, motion blur})"

# Optional motion blur: tblend averages each frame with the previous one. The
# frames are already distinct real renders, so this is a light, artifact-free
# blur (not the ghosting that minterpolate=blend produced on 25fps sources).
VF="format=yuv420p"
if [ "${BLUR:-0}" = "1" ]; then VF="tblend=all_mode=average,format=yuv420p"; fi

"$FFMPEG" -y -framerate 60 -i output/frames/%06d.png \
  -vf "$VF" \
  -c:v libx264 -pix_fmt yuv420p -movflags +faststart -crf 18 -r 60 "$OUT_MP4.tmp.mp4"

# validate with the full ffmpeg before swapping into place (the bundled build
# false-negatives on H.264, so never validate with Playwright's ffmpeg).
if "$FFMPEG" -v error -i "$OUT_MP4.tmp.mp4" -f null - >/dev/null 2>&1; then
  mv -f "$OUT_MP4.tmp.mp4" "$OUT_MP4"; echo "✓ Done: $OUT_MP4"
else
  rm -f "$OUT_MP4.tmp.mp4"; echo "✗ Output failed validation"; exit 1
fi

# Deliver to where the user actually looks for a finished video — ~/Downloads,
# not this script's working directory (a project folder or /tmp scratchpad).
OUT_DIR="${OUT_DIR:-$HOME/Downloads}"
mkdir -p "$OUT_DIR"
DEST="$OUT_DIR/$(basename "$OUT_MP4")"
cp -f "$OUT_MP4" "$DEST"
echo "✓ Delivered: $DEST"
