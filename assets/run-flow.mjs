// Generic, reusable demo-video RUNNER — no per-project script to write or
// edit. Describe the flow as a plain JSON list of steps (doctype, fields,
// actions, in whatever order the storyboard needs — nothing is required or
// assumed) and this file replays it with the exact same deterministic,
// frame-by-frame harness as reference-demo.mjs (stage, cursor, capture,
// primitives, boot, auth — all identical, copied verbatim, not reinvented).
//
// Usage: node run-flow.mjs <steps.json>
//   DEMO_URL / DEMO_USER / DEMO_PASS / BENCH   same env vars as reference-demo.mjs
//
// Why this exists: writing a new .mjs storyboard (copy reference-demo.mjs,
// hand-edit run()) for every single video request doesn't scale when someone
// just wants to hand over a flow in plain words ("create a Lead, show its
// print preview, back to the list, then an Opportunity..."). This file is
// the one thing that should ever need running — translate the requested flow
// into steps.json (a list of {action: input} objects, each action name
// matching one of the primitives below 1:1) and run it. No new JS, no new
// per-doctype reset script: every doc this run CREATES is tracked
// automatically and deleted by --reset (see bottom), generically, for any
// doctype — not hand-written per project the way reset-demo.py used to be.
//
// Example steps.json:
// [
//   {"newDoc": "Lead"},
//   {"setField": {"first_name": "Demo", "last_name": "Prospect", "email_id": "demo@example.com"}},
//   {"saveForm": true},
//   {"openPrintView": true},
//   {"closeExtraTab": true},
//   {"backToListView": true},
//   {"searchAndCreateNew": "Opportunity"},
//   {"setField": {"opportunity_from": "Lead", "party_name": "{{Lead.1}}"}},
//   {"saveForm": true},
//   {"backToListView": true}
// ]
//
// `"{{Lead.1}}"` refers to the name of the 1st document CREATED of doctype
// "Lead" so far this run (1-indexed) — lets a later step reference an
// earlier step's result without knowing its generated name in advance.
//
// Every primitive from reference-demo.mjs is available as a step by its own
// name (newDoc, setField, setFrappeLinkField, saveForm, submitForm,
// ensureGridRow, setGridField, closeGridRow, clickTab, scrollToSel,
// clickListRow, backToListView, openPrintView, searchAndOpenDoctype,
// searchAndCreateNew, switchListView, toggleListFilter, clickCustomButton,
// clickGroupItem, maskSelectors, unmaskSelectors, caption, holdIdle, hold,
// gotoApp, runReport, scrollReportBody, toggleCheck, reloadDoc, and more) —
// see STEP_HANDLERS below for the exact argument shape each expects, or just
// read reference-demo.mjs's own function signatures; a step's input is
// passed straight through as that function's arguments.

import { chromium, request } from "playwright";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "output");
const FRAME_DIR = path.join(OUT_DIR, "frames");

const STEPS_FILE = process.argv[2];
if (!STEPS_FILE) {
  console.error("Usage: node run-flow.mjs <steps.json> [--reset-only]");
  process.exit(1);
}
const RESET_ONLY = process.argv.includes("--reset-only");

// Connection — override via env for your own bench/site. Defaults are placeholders;
// set a known admin password first: `bench --site <site> set-admin-password <pwd>`.
const BASE = process.env.DEMO_URL || "http://mysite.localhost:8000";
// Window titlebar text (the stage's cosmetic "app name" shown in the fake
// traffic-light bar) — override per-recording via env; generic by default so
// nothing here reads as built for one specific app/module.
const WINDOW_TITLE = process.env.DEMO_TITLE || "Frappe";
const USER = process.env.DEMO_USER || "Administrator";
const PASS = process.env.DEMO_PASS || "changeme";
const BENCH = process.env.BENCH || `${process.env.HOME}/frappe-bench`;

// CSS viewport; captured at 2x -> 3200x1800. Width must stay comfortably above
// Frappe's form-sidebar collapse breakpoints (991px, and Bootstrap's xl ~1200px)
// AFTER the stage's wallpaper margin eats into it: #win sits at left:3%/right:3%,
// so the app iframe only gets ~94% of VIEW.width. At the old 1280px that left
// ~1203px for the iframe -- right at the edge -- and the right sidebar
// (Assign/Attachments/Tags/Share, 277px wide per form_sidebar.scss) got clipped
// or hidden. 1600px leaves the iframe ~1504px, safely past both breakpoints.
const VIEW = { width: 1600, height: 900 }; // CSS viewport; captured at 2× → 3200×1800
const SCALE = 2; // retina capture scale (Page.captureScreenshot clip.scale)
const FPS = 60;
const STEP = 1000 / FPS;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// easings
const easeOut = (t) => 1 - Math.pow(1 - t, 3); // ease-out cubic (settle-into-target)
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;

// ----------------------------------------------------------------- stage page
// No CSS transitions — position/scale are set explicitly per frame from Node.
const STAGE = `<!doctype html><html><head><meta charset="utf8"><style>
html,body{margin:0;height:100%;overflow:hidden;background:#000;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
#wall{position:fixed;inset:0;background:
  radial-gradient(1200px 820px at 16% 10%, rgba(96,150,255,.50), transparent 60%),
  radial-gradient(1100px 760px at 90% 92%, rgba(180,110,255,.42), transparent 60%),
  radial-gradient(900px 600px at 60% 50%, rgba(80,200,220,.18), transparent 60%),
  linear-gradient(135deg,#0c1733,#21356f 45%,#3766cf)}
#win{position:fixed;top:3.6%;left:3%;right:3%;bottom:3.6%;background:#fff;
  border-radius:16px;overflow:hidden;box-shadow:0 60px 150px rgba(0,0,0,.55),0 12px 34px rgba(0,0,0,.35)}
#bar{height:46px;background:#eef1f5;display:flex;align-items:center;padding:0 20px;gap:11px;border-bottom:1px solid #dbe1e8}
#bar .d{width:15px;height:15px;border-radius:50%}
.rr{background:#ff5f57}.yy{background:#febc2e}.gg{background:#28c840}
#bar .t{margin-left:18px;font-size:16px;color:#586472;font-weight:600;letter-spacing:.2px}
#app{width:100%;height:calc(100% - 46px);border:0;display:block;background:#fff}
#caption{position:fixed;left:50%;bottom:6.5%;transform:translateX(-50%);max-width:78%;
  background:rgba(17,20,28,.86);color:#fff;font-size:19px;line-height:1.4;font-weight:500;
  padding:12px 22px;border-radius:12px;text-align:center;opacity:0;pointer-events:none;
  box-shadow:0 10px 30px rgba(0,0,0,.35);z-index:2147483647}
</style></head><body>
<div id="wall"></div>
<div id="win">
 <div id="bar"><span class="d rr"></span><span class="d yy"></span><span class="d gg"></span><span class="t">${WINDOW_TITLE}</span></div>
 <iframe id="app" name="app" src="about:blank"></iframe>
</div>
<div id="caption"></div>
</body></html>`;

// cursor + ripple ring, injected into the app iframe only. NO transitions —
// Node sets absolute position / ring scale+opacity every frame.
// Cursor is sized up ~1.4x (46px -> 64px) so it reads clearly on small/mobile
// playback. __setCursorOpacity drives the idle-fade; __setFieldRing draws a
// focus highlight around whatever field is being typed into.
const INIT = `
(() => {
  var ARROW='<svg width=64 height=64 viewBox="0 0 24 24"><path d="M4 2l16 7-6.5 2.2L11 18 4 2z" fill="#fff" stroke="#1a1a1a" stroke-width="1.2" stroke-linejoin="round"/></svg>';
  var HAND='<svg width=64 height=64 viewBox="0 0 24 24"><path d="M9 11.5V5.6a1.4 1.4 0 0 1 2.8 0v4.4m0-.6a1.4 1.4 0 0 1 2.8 0v1m0-.6a1.4 1.4 0 0 1 2.8 0v3.2c0 3-2 5.4-5.2 5.4-1.9 0-3-.6-4.2-1.9l-2.8-3.1a1.35 1.35 0 0 1 1.9-1.9l1.5 1.4V6.4a1.4 1.4 0 0 1 2.8 0v5.1" fill="#fff" stroke="#1a1a1a" stroke-width="1.1" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  // install() is IDEMPOTENT by construction, not by a single check-then-skip
  // guard: it always removes every existing #demo-* node (querySelectorAll, not
  // getElementById -- catches duplicates too, not just the first match) before
  // creating a fresh set. Frappe's desk tears down and rebuilds large DOM
  // subtrees on some route/refresh transitions WITHOUT a real page navigation
  // (no new document, so this initScript does not naturally re-run) -- if that
  // rebuild detaches the cursor nodes but leaves window.__setCursor etc. bound
  // to the old (now-detached) elements, every subsequent __setCursor call is a
  // silent no-op against nodes nothing paints, while the 400ms safety poll
  // below reinstalls a SECOND, visible set without first clearing the old
  // closures -- this is the "multiple cursors" defect: not two DOM nodes
  // fighting for the same id, but old and new __setCursor closures both still
  // being invoked (every setCursorInFrame call hits whatever closure
  // window.__setCursor currently points to -- only the newest install's nodes
  // actually move, but a stale set can remain painted at its last position if
  // it was re-parented rather than removed). Always clearing by class before
  // creating new nodes, every single poll tick (not just when a prior node is
  // "missing"), makes this self-healing regardless of how Frappe mutates the
  // DOM underneath it.
  //
  // The stage-shell exclusion is checked INSIDE install(), not once at the top
  // of this IIFE. addInitScript runs at document_start, before ANY of the
  // page's own HTML (including the stage's own <iframe id="app"> tag) has been
  // parsed -- at that instant document.getElementById('app') is always null,
  // even on the stage shell itself, so a one-time check here never correctly
  // excludes the stage shell, and it gets a cursor installed too (composited
  // into the same cap() screenshot as the app iframe's cursor = two visible
  // cursors, the "multiple cursors" bug). Re-check on every install() call
  // instead, by which point document.body exists and the iframe tag has been
  // parsed, so the stage shell is reliably identifiable.
  function install(){
    if (!document.body) return;
    if (!window.frameElement && document.getElementById('app')) return; // this IS the stage shell
    // Skip the rebuild entirely when the existing cursor/ring nodes are still
    // attached and live (document.contains, not just non-null) — the 400ms
    // safety poll used to tear down and recreate all three overlay nodes on
    // EVERY tick regardless of whether anything actually needed it, which
    // reads on camera as the cursor flickering/blinking every ~0.4s even
    // while perfectly idle. Only a genuinely stale/detached node (the "Frappe
    // rebuilt the DOM underneath us" case this poll exists for) should pay
    // for a fresh install.
    var existingCur = document.getElementById('demo-cursor');
    var existingRing = document.getElementById('demo-ring');
    var existingFRing = document.getElementById('demo-field-ring');
    if (existingCur && document.body.contains(existingCur) &&
        existingRing && document.body.contains(existingRing) &&
        existingFRing && document.body.contains(existingFRing) &&
        window.__setCursor) {
      return; // already installed and live — nothing to do
    }
    document.querySelectorAll('.__demo-overlay').forEach(function(n){ n.remove(); });
    var st=document.createElement('style');
    st.className='__demo-overlay';
    st.textContent='.__demo-overlay{transition:none !important}#demo-cursor{position:fixed;z-index:2147483647;width:64px;height:64px;margin:-6px 0 0 -6px;pointer-events:none}#demo-cursor svg{filter:drop-shadow(0 4px 5px rgba(0,0,0,.45))}#demo-ring{position:fixed;z-index:2147483646;width:84px;height:84px;margin:-42px 0 0 -42px;border-radius:50%;pointer-events:none;background:rgba(64,120,255,.4);transform:scale(0);opacity:0}#demo-field-ring{position:fixed;z-index:2147483645;border-radius:8px;pointer-events:none;box-shadow:0 0 0 3px rgba(64,120,255,.85),0 0 16px 2px rgba(64,120,255,.35);opacity:0}';
    document.head&&document.head.appendChild(st);
    var cur=document.createElement('div');cur.id='demo-cursor';cur.className='__demo-overlay';cur.innerHTML=ARROW;
    var ring=document.createElement('div');ring.id='demo-ring';ring.className='__demo-overlay';
    var fring=document.createElement('div');fring.id='demo-field-ring';fring.className='__demo-overlay';
    document.body.appendChild(fring);document.body.appendChild(ring);document.body.appendChild(cur);
    var x=(window.__cx!=null?window.__cx:innerWidth/2), y=(window.__cy!=null?window.__cy:innerHeight/2);
    cur.style.left=x+'px';cur.style.top=y+'px';ring.style.left=x+'px';ring.style.top=y+'px';
    window.__setCursor=(x,y)=>{window.__cx=x;window.__cy=y;cur.style.left=x+'px';cur.style.top=y+'px';ring.style.left=x+'px';ring.style.top=y+'px';};
    window.__setCursorType=(t)=>{cur.innerHTML=(t==='pointer')?HAND:ARROW;};
    window.__setCursorOpacity=(o)=>{cur.style.opacity=o;};
    window.__setRing=(s,o)=>{ring.style.transform='scale('+s+')';ring.style.opacity=o;};
    window.__setFieldRing=(x,y,w,h,o)=>{
      if (x==null){fring.style.opacity=0;return;}
      fring.style.left=x+'px';fring.style.top=y+'px';fring.style.width=w+'px';fring.style.height=h+'px';fring.style.opacity=o;
    };
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
  // Re-poll on a short interval AND on Frappe's own SPA route-change signal
  // (frappe.router fires this on every set_route, which is exactly when a
  // wholesale DOM rebuild without a real navigation is most likely) so a
  // rebuilt page gets a fresh, single cursor as soon as possible rather than
  // waiting out a full poll tick with no cursor visible at all.
  setInterval(install,400);
  document.addEventListener('page-change', install);
})();
`;

let page, cdp;
// F() returns the thing every primitive's actions/measurements run against.
// On the STAGE page this is the app iframe ("app"); but a tab opened via
// openPrintView()'s "Full Page" button (or any other real new-tab
// navigation) is a bare standalone page with NO stage shell and NO "app"
// iframe at all — page.frame("app") there returns null, and every primitive
// built on F().evaluate(...) throws "Cannot read properties of null".
// Confirmed as a real, not hypothetical, bug: a render failed exactly this
// way immediately after openPrintView()'s new tab opened successfully.
// Falling back to the page itself when no "app" frame exists makes every
// existing primitive work unchanged on a plain page, not just inside the
// stage's iframe — it only matters that F() is a real page/frame runners can
// call .evaluate()/.waitForFunction() on.
const F = () => page.frame("app") || page;

// ---------------------------------------------------------- frame capture
let FRAME = 0;
const framePath = (i) => path.join(FRAME_DIR, String(i).padStart(6, "0") + ".png");
// Async, non-blocking disk writes — cap()'s CDP screenshot is the real per-frame
// cost (a round trip into the browser's compositor); the write to disk is pure
// overhead the event loop doesn't need to sit through before starting the NEXT
// CDP call. Pending writes are tracked and flushed once at the very end (see
// flushFrameWrites, called before encode), so a render can never finish with
// frames still mid-write, but a slow disk no longer serializes with capture.
// A bounded queue (not unlimited fire-and-forget) caps how far writes can lag
// behind capture — an unbounded one risks thousands of buffers resident at once
// on a disk slower than the capture rate, trading one bottleneck for an OOM.
const MAX_PENDING_WRITES = 24;
let pendingWrites = [];
async function queueWrite(i, buf) {
  const p = fs.promises.writeFile(framePath(i), buf).finally(() => {
    pendingWrites = pendingWrites.filter((x) => x !== p);
  });
  pendingWrites.push(p);
  if (pendingWrites.length >= MAX_PENDING_WRITES) await Promise.race(pendingWrites);
}
async function flushFrameWrites() {
  await Promise.all(pendingWrites);
}
// raw CDP capture — Playwright's page.screenshot waits for a fresh compositor
// frame and hangs mid-animation; raw captureScreenshot grabs the surface now.
// clip.scale renders at 2× for genuine retina text (DSF is ignored by capture).
//
// lastFrameBuf caches the most recently captured PNG buffer IN MEMORY so dup()
// never has to read it back off disk. This is not just an optimization: once
// queueWrite() made writes async (see above), cap() returns as soon as the
// write is QUEUED, not once it has actually landed on disk — a dup() called
// right after cap() that tried fs.readFile(framePath(FRAME-1)) could race
// that pending write and throw ENOENT on a file that "exists" (per FRAME's
// own counter) but hasn't been flushed yet. Observed in practice: a render
// failed at frame 16 with exactly this error, immediately after converting
// cap()/dup() to async writes. Keeping the buffer in memory sidesteps the
// race entirely — there is nothing to wait on, because nothing is read from
// disk at all.
let lastFrameBuf = null;
async function cap() {
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    clip: { x: 0, y: 0, width: VIEW.width, height: VIEW.height, scale: SCALE },
    captureBeyondViewport: false,
  });
  lastFrameBuf = Buffer.from(data, "base64");
  await queueWrite(FRAME, lastFrameBuf);
  FRAME++;
}
// duplicate the last captured frame n times (cheap dwell — no re-render).
// Reuses the in-memory buffer cap() just captured — see lastFrameBuf's
// comment above for why this must not re-read the file from disk.
async function dup(n) {
  if (FRAME === 0 || n <= 0 || !lastFrameBuf) return;
  for (let i = 0; i < n; i++) { await queueWrite(FRAME, lastFrameBuf); FRAME++; }
}
const framesFor = (ms) => Math.max(1, Math.round(ms / STEP));

// ---------------------------------------------------------------- primitives
// Burned-in on-screen caption/subtitle, shown on the STAGE page (outside the
// app iframe, via page.evaluate not F().evaluate) so it survives app
// navigation, SPA route changes, and even switching to a new tab for the
// print-preview beat without having to be re-injected per document the way
// the cursor overlay must be. Burned-in rather than a sidecar .srt/.vtt file:
// this pipeline's deterministic output IS the frame sequence, so baking the
// caption into the same captured frames keeps it exactly in sync with no
// separate muxing/timing step, and a client opening the .mp4 anywhere sees it
// without needing to enable a subtitle track. Call before a hold()/dwell that
// should carry the explanation, and call caption("") (empty) to clear it
// before the next action if it shouldn't linger into the next beat.
async function setCaptionText(text) {
  await page.evaluate((t) => {
    const el = document.getElementById("caption");
    if (el) el.textContent = t || "";
  }, text).catch(() => {});
}
async function setCaptionOpacity(o) {
  await page.evaluate((v) => {
    const el = document.getElementById("caption");
    if (el) el.style.opacity = v;
  }, o).catch(() => {});
}
async function caption(text, holdMs = 1600, fadeMs = 220) {
  await setCaptionText(text);
  const nIn = framesFor(fadeMs);
  for (let i = 1; i <= nIn; i++) { await setCaptionOpacity(easeOut(i / nIn)); await cap(); }
  await hold(holdMs);
  const nOut = framesFor(fadeMs);
  for (let i = 1; i <= nOut; i++) { await setCaptionOpacity(1 - easeOut(i / nOut)); await cap(); }
  await setCaptionText("");
}
// For a long dwell where the caption should stay up THROUGH the hold rather
// than fade before it (e.g. explaining a background job while its toast is
// still visible) — fades in, leaves it showing, and the NEXT caption()/
// clearCaption() call is responsible for fading it back out.
async function captionPersist(text, fadeMs = 220) {
  await setCaptionText(text);
  const n = framesFor(fadeMs);
  for (let i = 1; i <= n; i++) { await setCaptionOpacity(easeOut(i / n)); await cap(); }
}
async function clearCaption(fadeMs = 220) {
  const n = framesFor(fadeMs);
  for (let i = 1; i <= n; i++) { await setCaptionOpacity(1 - easeOut(i / n)); await cap(); }
  await setCaptionText("");
}

// cursor state (in-frame coords)
let cx = VIEW.width / 2, cy = VIEW.height / 2;
async function setCursorInFrame(x, y) {
  await F().evaluate(([x, y]) => window.__setCursor && window.__setCursor(x, y), [x, y]).catch(() => {});
}
async function setCursorType(t) {
  await F().evaluate((x) => window.__setCursorType && window.__setCursorType(x), t).catch(() => {});
}
async function setRing(s, o) {
  await F().evaluate(([s, o]) => window.__setRing && window.__setRing(s, o), [s, o]).catch(() => {});
}
async function setCursorOpacity(o) {
  await F().evaluate((v) => window.__setCursorOpacity && window.__setCursorOpacity(v), o).catch(() => {});
}
async function setFieldRing(rect, o) {
  await F().evaluate(([r, o]) => {
    if (!window.__setFieldRing) return;
    if (!r) { window.__setFieldRing(null); return; }
    window.__setFieldRing(r.x - 6, r.y - 4, r.w + 12, r.h + 8, o);
  }, [rect, o]).catch(() => {});
}
// Data masking: blur one or more selectors (real emails, server URLs, client
// names, financial figures) with a CSS blur applied directly in the app iframe
// — it's baked into every captured frame, not a post-process overlay that could
// be skipped or misaligned. Call once per screen, right after the content that
// needs masking is on screen and before any hold()/cap() of that frame.
async function maskSelectors(selectors) {
  await F().evaluate((sels) => {
    for (const s of sels) {
      document.querySelectorAll(s).forEach((el) => {
        el.style.filter = "blur(6px)";
        el.style.userSelect = "none";
      });
    }
  }, selectors).catch(() => {});
}
async function unmaskSelectors(selectors) {
  await F().evaluate((sels) => {
    for (const s of sels) {
      document.querySelectorAll(s).forEach((el) => { el.style.filter = ""; });
    }
  }, selectors).catch(() => {});
}
// Fade the cursor out/in while the storyboard is just dwelling on a settled
// state with no navigation coming next — an idle cursor sitting in the frame
// reads as a mistake, not a pause. Call fadeCursorOut() before a long hold()
// that isn't leading into another click, and fadeCursorIn() before the next glide.
async function fadeCursorOut(durMs = 260) {
  const n = framesFor(durMs);
  for (let i = 1; i <= n; i++) { await setCursorOpacity(1 - easeOut(i / n)); await cap(); }
}
async function fadeCursorIn(durMs = 200) {
  const n = framesFor(durMs);
  for (let i = 1; i <= n; i++) { await setCursorOpacity(easeOut(i / n)); await cap(); }
}

async function rectOf(sel) {
  return F().evaluate((s) => {
    // Multiple elements can match the SAME selector at once — confirmed as a
    // real, not hypothetical, cause of a real failure: after a search-driven
    // list navigation, TWO `.page-head .primary-action` buttons existed
    // simultaneously (one a hidden leftover from the previous screen's
    // toolbar, `class="... primary-action hide"`, the other the real,
    // visible "Add Loan" button). `document.querySelector` always returns
    // the FIRST match in document order regardless of visibility — if that
    // happens to be the hidden leftover, this returned null (correctly
    // treating a zero-size element as "not there"), which made a perfectly
    // real, on-screen button look missing. Scan ALL matches and return the
    // first one that's actually visible, instead of only ever checking the
    // first match found.
    const candidates = document.querySelectorAll(s);
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      if (r.width || r.height) {
        return { x: r.left, y: r.top, w: r.width, h: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      }
    }
    return null; // every match was hidden (e.g. a collapsed section's field), or there were none
  }, sel);
}
// Clicks the first VISIBLE element matching `sel` — not just the first
// match in document order. Use this (not a bare
// `document.querySelector(sel)?.click()` inline in F().evaluate) for every
// click-driving primitive, for the same reason `rectOf` above scans all
// matches: a hidden leftover element from a previous screen's toolbar can
// share the exact same selector as the real, visible target (confirmed on
// `.page-head .primary-action` after a search-driven list navigation), and
// a plain querySelector().click() has no visibility check at all — it would
// silently click the WRONG, invisible element instead of throwing the clear
// "not found" error `rectOf`-based primitives get from this same hazard.
async function clickVisible(sel) {
  return F().evaluate((s) => {
    const candidates = document.querySelectorAll(s);
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      if (r.width || r.height) { el.click(); return true; }
    }
    return false;
  }, sel);
}
// Resolves a working `[data-fieldname="..."]` selector for a field even when
// the fieldname itself might not be what you expect — a heavily customized
// ERPNext instance can rename/relabel standard fields via Customize Form, or
// you may only know a field by what it says on screen, not its backend name.
// Tries the fieldname first (cheap, exact); if that resolves to nothing or a
// zero-size element, falls back to matching the field's own `.control-label`
// text against `labelOrFieldname` (case-insensitive substring) and returns
// that field wrapper's OWN fieldname-based selector — confirmed from
// base_input.js: every field wrapper renders a `label.control-label` and
// carries its own `[data-fieldname]`, so once the label match finds the
// wrapper, the fieldname selector it returns works with every OTHER primitive
// in this harness (setField, revealField, rectOf) unchanged.
async function getFrappeFieldSelector(labelOrFieldname) {
  const byName = `[data-fieldname="${labelOrFieldname}"]`;
  const existsByName = await F().evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return !!(r.width || r.height);
  }, byName).catch(() => false);
  if (existsByName) return byName;

  const foundFieldname = await F().evaluate((label) => {
    const needle = label.trim().toLowerCase();
    const labels = document.querySelectorAll(".control-label");
    for (const lbl of labels) {
      if (lbl.textContent.trim().toLowerCase().includes(needle)) {
        const wrapper = lbl.closest("[data-fieldname]");
        if (wrapper) return wrapper.getAttribute("data-fieldname");
      }
    }
    return null;
  }, labelOrFieldname).catch(() => null);

  return foundFieldname ? `[data-fieldname="${foundFieldname}"]` : byName;
}

// eased cursor glide from current pos to (tx,ty); one captured frame per step
async function glide(tx, ty, durMs = 620) {
  const n = framesFor(durMs);
  const sx = cx, sy = cy;
  // ease-in-out for long travels, ease-out for short settles
  const dist = Math.hypot(tx - sx, ty - sy);
  const ease = dist > 380 ? easeInOut : easeOut;
  for (let i = 1; i <= n; i++) {
    const t = ease(i / n);
    await setCursorInFrame(lerp(sx, tx, t), lerp(sy, ty, t));
    await cap();
  }
  cx = tx; cy = ty;
}
// Every click-driving primitive below follows measure -> glide -> ripple ->
// click. ripple()/glide() run for several hundred ms of captured frames, and
// Frappe's UI can reflow DURING that window (a toast appearing, a sibling
// field's dependent visibility changing, a grid re-rendering) — if that
// happens, the cursor visually settles at the ORIGINAL measured coordinates
// while the real target has moved, so the ripple appears over empty space and
// the click (fired at a re-queried live element, not literal x/y) succeeds
// invisibly somewhere else on screen. This reads as "click going to the wrong
// place" even though the underlying action is correct. Fix: re-measure right
// before the actual click and, if the target moved more than a few px, do a
// fast corrective glide first so the visible ripple always lands on the
// button's CURRENT position, not its pre-reflow one.
async function settleOnLive(sel, prevRect) {
  const liveR = await rectOf(sel);
  if (!liveR) return prevRect; // element vanished (e.g. menu closed) — nothing to correct
  if (!prevRect || Math.hypot(liveR.cx - prevRect.cx, liveR.cy - prevRect.cy) > 4) {
    await glide(liveR.cx, liveR.cy, 160); // short, cheap correction — not a full re-travel
  }
  return liveR;
}
async function glideToSel(sel, dx = 0.5, dy = 0.5, durMs) {
  const r = await rectOf(sel);
  if (!r) return null;
  await glide(r.x + r.w * dx, r.y + r.h * dy, durMs);
  return r;
}

// Find the nearest scrollable ancestor of `sel` (Frappe forms scroll a
// `.layout-main-section-wrapper` or similar, not the document) and return
// its current/max scrollTop plus the target element's offset within it.
async function scrollInfo(sel) {
  return F().evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    let node = el.parentElement;
    while (node && node !== document.body) {
      if (node.scrollHeight > node.clientHeight + 4) {
        const cs = getComputedStyle(node);
        if (/(auto|scroll)/.test(cs.overflowY)) break;
      }
      node = node.parentElement;
    }
    const scroller = node && node !== document.body ? node : document.scrollingElement;
    if (!scroller) return null;
    const sRect = scroller.getBoundingClientRect();
    const eRect = el.getBoundingClientRect();
    // Sticky obstructions eat into the TOP of the visible area without
    // shrinking scroller.clientHeight (they overlay, not reflow) -- a target
    // centered against the full clientHeight can land its top edge hidden
    // under .page-head (sticky, top:0, z-index:6 per page.scss) and/or
    // .form-tabs-list (sticky, z-index:5 per form.scss) even though the
    // scroll math says it's "in view". Measure their actual rendered height
    // (0 if not present/not sticky right now, e.g. no tabs on this doctype)
    // and treat that as dead space at the top of the usable viewport.
    let stickyH = 0;
    for (const stickySel of [".page-head", ".form-tabs-list"]) {
      const sticky = document.querySelector(stickySel);
      if (sticky && getComputedStyle(sticky).position === "sticky") {
        stickyH += sticky.getBoundingClientRect().height;
      }
    }
    const usableH = Math.max(sRect.height - stickyH, eRect.height + 20);
    // offset of el's center within the scroller's content, minus half the
    // USABLE (sticky-adjusted) visible height, centers the target in the
    // space actually clear of overlaying headers.
    const target = scroller.scrollTop + (eRect.top - sRect.top) - stickyH - (usableH / 2 - eRect.height / 2);
    return {
      top: scroller.scrollTop,
      max: scroller.scrollHeight - scroller.clientHeight,
      target: Math.max(0, Math.min(target, scroller.scrollHeight - scroller.clientHeight)),
    };
  }, sel);
}
async function setScrollTop(px) {
  await F().evaluate((v) => {
    let node = window.__scrollTarget;
    (node || document.scrollingElement).scrollTop = v;
  }, px).catch(() => {});
}
// Deterministic, captured scroll: tween scrollTop frame-by-frame instead of an
// instant scrollIntoView/scroll_to_field jump. Without this the page teleports
// between frames and the cosmetic cursor looks disconnected from the content
// moving under it — this is the "scroll is missing" gap in the old harness.
async function scrollToY(targetTop, durMs = 700) {
  const cur = await F().evaluate(() => {
    const node = window.__scrollTarget || document.scrollingElement || document.body;
    return node.scrollTop;
  }).catch(() => 0);
  const n = framesFor(durMs);
  for (let i = 1; i <= n; i++) {
    const t = easeInOut(i / n);
    await setScrollTop(lerp(cur, targetTop, t));
    await cap();
  }
}
// Scroll whichever ancestor of `sel` actually scrolls, centering it in view.
// Falls back to a no-op (not an instant jump) if the element is already in view.
async function scrollToSel(sel, durMs = 700) {
  const info = await scrollInfo(sel);
  if (!info) return;
  if (Math.abs(info.target - info.top) < 8) return; // already in view
  // mark which node to drive (scroller may not be document.scrollingElement)
  await F().evaluate((s) => {
    const el = document.querySelector(s);
    let node = el.parentElement;
    while (node && node !== document.body) {
      if (node.scrollHeight > node.clientHeight + 4 && /(auto|scroll)/.test(getComputedStyle(node).overflowY)) break;
      node = node.parentElement;
    }
    window.__scrollTarget = (node && node !== document.body) ? node : null;
  }, sel).catch(() => {});
  await scrollToY(info.target, durMs);
  await F().evaluate(() => { window.__scrollTarget = null; }).catch(() => {});
}
// click ripple centered on cursor (expand + fade)
async function ripple(durMs = 420) {
  const n = framesFor(durMs);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    await setRing(easeOut(t) * 1.0, (1 - t) * 0.85);
    await cap();
  }
  await setRing(0, 0);
}
// A short, FIXED dwell after the cursor arrives on a target and before the
// ripple/click fires — glide() landing directly into ripple() with nothing
// captured in between reads as the cursor "teleporting and instantly firing"
// rather than a deliberate click. This is cosmetic timing only (no randomness
// — see SKILL.md on why this harness keeps motion deterministic even where it
// reads as natural); call it between glide() and ripple() in any new
// click-driving primitive. Existing primitives already have their own
// settle-then-ripple pattern via settleOnLive(); this is the plain version for
// a primitive that doesn't need a live re-measure.
async function hoverDwell(ms = 180) {
  await hold(ms);
}
// dwell on the current settled state (1 real frame + cheap duplicates)
async function hold(ms = 900) {
  await cap();
  await dup(framesFor(ms) - 1);
}
// A longer dwell with no click coming next (e.g. pausing on a finished report,
// a dashboard, a dialog you're narrating over): fade the cursor out of the way
// first so it doesn't just sit there looking stuck, then back in before the
// next glide. Short holds between consecutive actions should keep using hold().
async function holdIdle(ms = 1400) {
  await fadeCursorOut();
  await hold(Math.max(1, ms - 460));
  await fadeCursorIn();
}

// timeout-protected in-frame async call (never hangs node; retries on nav race)
async function fEval(fnText, arg = null, ms = 15000, retry = true) {
  let res;
  try {
    res = await F().evaluate(([s, a, t]) => {
      const f = (0, eval)("(" + s + ")");
      return new Promise((resolve) => {
        let d = false; const fin = (v) => { if (!d) { d = true; resolve(v); } };
        setTimeout(() => fin({ timeout: true }), t);
        Promise.resolve(f(a)).then((x) => fin({ ok: x })).catch((e) => fin({ err: String((e && e.message) || e) }));
      });
    }, [fnText, arg, ms]);
  } catch (e) {
    if (retry && /context was destroyed|Execution context|navigation/i.test(e.message)) {
      await sleep(1000); return fEval(fnText, arg, ms, false);
    }
    throw e;
  }
  if (res && res.err) throw new Error("in-page: " + res.err);
  if (res && res.timeout) throw new Error("in-page timeout");
  return res ? res.ok : undefined;
}

// ------------------------------------------------------------------- actions
// (real interactions run in wall clock and are NOT captured)
// The settle pause after a form is ready is captured as real frames (hold),
// not a dead sleep — a bare sleep() here freezes the video on the PRE-load
// frame for its whole duration (no frames generated), so the cut to the
// loaded form looks like a multi-second stall instead of a deliberate dwell.
// This was the source of the "2-3 sec of nothing after a click" complaint:
// waitForm -> newDoc -> saveForm etc. used to stack several uncaptured
// sleep()s back to back with zero frames between them.
async function waitForm(dt, settleMs = 260) {
  await F().waitForFunction(
    (d) => window.cur_frm && cur_frm.doctype === d && cur_frm.doc && document.querySelector(".form-layout"),
    dt, { timeout: 25000 }
  );
  await hold(settleMs);
}
// Verified navigation: a transient dev-server hiccup (reload race, momentary
// 500) satisfies waitUntil:"domcontentloaded" just like a real page, so a
// bare goto() can silently capture an error page as if it were content —
// nothing else in the harness ever checks this otherwise. One retry after a
// short pause recovers from exactly the transient case; a navigation to a raw
// file/API response (no HTTP response object, e.g. some download flows)
// skips the check rather than failing on it.
//
// "Redirect sometimes not good" (reported defect): domcontentloaded alone can
// fire while the desk's own client-side router is STILL mid-flight — Frappe's
// SPA resolves /app/<route> by loading the desk shell first, then
// frappe.router driving a SECOND, in-page route to the actual view (list/
// form/print). A goto() that returns the instant the shell's DOM exists (but
// before frappe.boot/frappe.router finish that second step) can get captured
// mid-transition — a blank content pane, or briefly the PREVIOUS route's
// content before the new one swaps in. Waiting for window.frappe.boot (proof
// the desk app itself finished bootstrapping) in addition to the HTTP
// response status closes that gap generically, for every route, not just the
// specific ones individual callers already waitForFunction on afterward.
async function gotoApp(pathPart, { retries = 1 } = {}) {
  const url = pathPart.startsWith("http") ? pathPart : BASE + pathPart;
  let res;
  try {
    res = await F().goto(url, { waitUntil: "domcontentloaded" });
  } catch (e) {
    if (retries > 0) { await sleep(800); return gotoApp(pathPart, { retries: retries - 1 }); }
    throw e;
  }
  if (res && res.status() >= 500 && retries > 0) {
    await sleep(800);
    return gotoApp(pathPart, { retries: retries - 1 });
  }
  if (res && res.status() >= 500) {
    throw new Error(`gotoApp: ${url} returned ${res.status()} after retry`);
  }
  // Only a genuine desk page (/app/...) has frappe.boot to wait for — a
  // standalone www page (e.g. /printview) or a raw API/file response has no
  // such global, so this wait is skipped rather than failing on it.
  if (/\/app\//.test(url) || /\/desk\//.test(url)) {
    await F().waitForFunction(() => window.frappe && frappe.boot, null, { timeout: 20000 }).catch(() => {});
  }
  // a fresh document re-installs the cursor at its centre; keep Node's copy of the
  // position in step or the next glide tweens in from the previous page's coordinates
  const d = await F().evaluate(() => ({ w: innerWidth, h: innerHeight })).catch(() => null);
  if (d) { cx = d.w / 2; cy = d.h / 2; }
}
// Generic for any doctype: /<doctype>/new is Frappe's own route for a fresh
// document (the router treats a doc name starting with "new" as a signal to
// call frappe.model.make_new_doc_and_get_name() — see formview.js's
// render_new_doc — the same function frappe.new_doc() itself drives). Always
// navigate there rather than calling frappe.new_doc() directly: the app
// iframe starts at about:blank, where window.frappe does not exist yet, so a
// bare fEval("frappe.new_doc(...)") throws "frappe is not defined" unless a
// desk page already loaded frappe into the frame.
async function newDoc(dt) {
  await gotoApp("/app/" + frappe_slug(dt) + "/new");
  await F().waitForFunction(() => window.frappe && frappe.boot, null, { timeout: 25000 });
  // waitForm's own hold() already captures the settle pause as real frames;
  // networkidle is a genuine readiness signal (link/select fields can still be
  // fetching their options), but its own wait does not need a SECOND dead
  // sleep stacked after it — that was pure uncaptured dead time.
  await waitForm(dt);
  await F().waitForLoadState("networkidle").catch(() => {});
  await hold(300);
}
// Frappe slugs a doctype name for its URL by lowercasing and replacing spaces
// with hyphens (see router.js's `slug`); doctypes with no spaces are unaffected.
function frappe_slug(dt) {
  return encodeURIComponent(dt.toLowerCase().replace(/ /g, "-"));
}
// The desk's own Home/workspace screen — verified live: /app/home (and bare
// /app) resolve to the real workspace landing page, not a blank/placeholder
// route. Used as the realistic starting point for the FIRST doctype switch
// of a flow (see goToDoctypeRealistically in the flow executor below) —
// a real user opens the desk to its home screen before doing anything else,
// they don't land cold on a doctype's /new route.
async function goHome() {
  await gotoApp("/app/home");
  await F().waitForFunction(() => window.frappe && frappe.boot, null, { timeout: 25000 });
  await hold(600);
}
async function revealField(fn) {
  // scroll_to_field activates the containing tab instantly (no frames to
  // capture for a tab switch — that's fine, it's a pane swap not a scroll),
  // but leaves a COLLAPSED SECTION shut and jumps the scroll position. Do the
  // tab-activate + section-expand with no visible scroll yet, THEN drive the
  // actual scroll ourselves frame-by-frame so it's visible on camera.
  await F().evaluate((f) => {
    try {
      const field = window.cur_frm.get_field(f);
      const section = field.$wrapper.closest(".form-section");
      const tabPane = field.$wrapper.closest(".tab-pane");
      if (tabPane && tabPane.length && !tabPane.hasClass("show")) {
        const tabId = tabPane.attr("id");
        document.querySelector(`.form-tabs .nav-link[href="#${tabId}"]`)?.click();
      }
      const head = section.find(".section-head.collapsed");
      if (head.length) head.click();
    } catch (e) {}
  }, fn).catch(() => {});
  await sleep(350); // let the tab pane / section-expand reflow before measuring
  const sel = `[data-fieldname="${fn}"]`;
  const r = await rectOf(sel);
  if (!r) return; // still hidden (e.g. a depends_on condition) — nothing to scroll to
  await scrollToSel(sel, 650);
}
// Typed fields (data/text/currency/int/float/small_text) get a char-by-char
// typing effect instead of the value appearing in one frame — always a clean,
// even reveal (no simulated typos/backspaces/pauses, per the storyboard spec).
// Link/select/date/checkbox fields keep the old one-shot set_value (there's no
// "typing" a link/dropdown pick).
const TYPED_FIELDTYPES = new Set(["Data", "Text", "Small Text", "Currency", "Int", "Float", "Phone", "Code"]);
async function fieldType(fn) {
  return F().evaluate((f) => {
    try { return window.cur_frm.get_field(f).df.fieldtype; } catch (e) { return null; }
  }, fn).catch(() => null);
}
async function setField(fn, val) {
  // Skip fields that are already correctly populated (most commonly a
  // fetch_from field auto-filled when its source Link was set, e.g. an
  // address/rate/description pulled from a parent record) — re-typing the
  // SAME value over an already-fetched one is pointless on screen and reads
  // as the storyboard not trusting its own data. Compare loosely (string,
  // trimmed) since currency/int fields can come back as numbers vs strings.
  const existing = await F().evaluate((f) => {
    try { return window.cur_frm.doc[f]; } catch (e) { return undefined; }
  }, fn).catch(() => undefined);
  if (existing !== undefined && existing !== null && String(existing).trim() === String(val).trim()) {
    return; // already has the exact value we were about to type — nothing to show
  }
  // Scroll the field into view FIRST, before measuring or gliding to it — a
  // field below the fold has a rect whose y is off-screen (or clipped), so
  // glide/setFieldRing would aim at a coordinate that isn't where the field
  // actually renders once scrolled. This was the "enter data in a lower
  // section without scrolling first" defect: setField never called
  // revealField/scrollToSel itself, so any caller that forgot to scroll first
  // got a cursor/ring aimed at a pre-scroll (or entirely absent) position.
  await revealField(fn);
  await setCursorType("default");
  const sel = `[data-fieldname="${fn}"]`;
  const r = await rectOf(sel);
  // Park the cursor just outside the field's RIGHT border, vertically
  // centered on it — not inside the text area at all, so the arrow's hotspot
  // (which renders at exactly (x,y): see the INIT overlay's
  // `margin:-6px 0 0 -6px`, a near-zero offset) never sits on top of the
  // glyphs being typed. Two earlier positions were tried and both read
  // wrong on camera: dead center (covers the text, the original defect) and
  // parked below the field (reads as floating disconnected from the input,
  // not like a hand that just finished typing there). Just past the right
  // edge reads as "resting right where typing ended" without ever
  // occluding the value — the natural place a cursor sits after filling a
  // single-line field.
  const restX = (rr) => rr.x + rr.w + 16;
  const restY = (rr) => rr.cy;
  if (r) await glide(restX(r), restY(r), 420);

  const ft = await fieldType(fn);
  const str = String(val);
  if (TYPED_FIELDTYPES.has(ft) && str.length > 0 && str.length <= 40) {
    const perChar = Math.max(28, Math.min(55, Math.round(380 / str.length)));
    for (let i = 1; i <= str.length; i++) {
      await fEval("async ([f,v]) => { cur_frm.set_value(f, v); }", [fn, str.slice(0, i)]);
      // Re-measure every keystroke, not once before the loop: set_value can
      // reflow the form (an error message appearing/disappearing, a currency
      // value changing width, a dependent field below showing/hiding and
      // shifting everything after it) while the ring position was frozen at
      // its pre-typing coordinates — this is the "ring blinking in the wrong
      // field" defect. Re-measuring and re-drawing the ring (and the cursor,
      // so it visually tracks a field that's sliding under it) every
      // iteration keeps both pinned to the field's REAL current position. The
      // cursor itself stays parked just past the field's right edge (see
      // restX/restY above) so it never covers the text actually being typed.
      const liveR = await rectOf(sel);
      if (liveR) {
        await setFieldRing(liveR, 0.9);
        await setCursorInFrame(restX(liveR), restY(liveR));
      }
      await cap();
      await dup(framesFor(perChar) - 1);
    }
    await fEval("async ([f,v]) => { await cur_frm.set_value(f, v); return cur_frm.doc[f]; }", [fn, val]);
  } else {
    const hr = await rectOf(sel);
    if (hr) await setFieldRing(hr, 0.9);
    await fEval("async ([f,v]) => { await cur_frm.set_value(f, v); return cur_frm.doc[f]; }", [fn, val]);
  }
  await F().evaluate(() => { try { window.$ && window.$(".awesomplete ul").hide(); } catch (e) {} }).catch(() => {});
  // Re-measure ONE more time after the final set_value settles (e.g. currency
  // formatting/validation can still shift things post-commit) before the
  // closing dwell, so the ring that lingers on screen during hold(480) is
  // anchored to the field's final, true position.
  const finalR = await rectOf(sel);
  if (finalR) await setFieldRing(finalR, 0.9);
  await hold(480); // show the filled value
  await setFieldRing(null, 0);
}
// Drives a Link field through its REAL awesomplete search UI instead of a
// one-shot cur_frm.set_value — for a storyboard beat where the search-and-pick
// interaction itself is the thing worth showing (most Link fields can still
// just use setField(), which is faster and fine when the dropdown isn't the
// point). Types the query character-by-character into the field's actual
// <input> (not cur_frm.set_value, which never touches the control's own input
// element or opens its dropdown), waits for Awesomplete's listbox to populate,
// glides to and clicks the first result, then waits for any fetch_from
// dependents to settle. DOM facts below confirmed by reading
// awesomplete.js + form/controls/link.js, not guessed:
//   - the control's <input> is sibling to a `ul[role="listbox"]` Awesomplete
//     creates next to it; closed state sets a `hidden` attribute on the ul,
//     open state removes it (see Awesomplete.close/open in awesomplete.js)
//   - result rows are `li[role="option"]` inside that ul
async function setFrappeLinkField(fn, query, { pick = 0 } = {}) {
  await revealField(fn);
  await setCursorType("default");
  const sel = `[data-fieldname="${fn}"]`;
  const r = await rectOf(sel);
  if (r) await glide(r.x + r.w * 0.25, r.cy, 420);
  const hr = await rectOf(sel);
  if (hr) await setFieldRing(hr, 0.9);

  const inputSel = `[data-fieldname="${fn}"] input.input-with-feedback`;
  // Focus first (a real user clicks into the field before typing) — Link
  // controls only wire up their awesomplete search on focus/input events, not
  // on a value assigned programmatically.
  await F().evaluate((s) => { const el = document.querySelector(s); el && el.focus(); }, inputSel).catch(() => {});
  await hold(200);

  const str = String(query);
  const perChar = Math.max(28, Math.min(55, Math.round(380 / Math.max(str.length, 1))));
  for (let i = 1; i <= str.length; i++) {
    const partial = str.slice(0, i);
    await F().evaluate(([s, v]) => {
      const el = document.querySelector(s);
      if (!el) return;
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, [inputSel, partial]).catch(() => {});
    await cap();
    await dup(framesFor(perChar) - 1);
  }

  // Wait for the awesomplete listbox to actually populate — the search is a
  // debounced async server call, not instant; a fixed sleep guesses wrong on
  // a slow site and either clicks nothing or clicks a stale empty list.
  const listSel = `[data-fieldname="${fn}"] ul[role="listbox"]`;
  const gotResults = await F().waitForFunction((s) => {
    const ul = document.querySelector(s);
    return ul && !ul.hasAttribute("hidden") && ul.querySelector('li[role="option"]');
  }, listSel, { timeout: 8000 }).then(() => true).catch(() => false);

  if (!gotResults) {
    // No match for this query — fall back to committing it as a literal value
    // via set_value rather than leaving the field mid-search with an open,
    // empty dropdown on screen. Caller should pass a query that's expected to
    // resolve; this is a safety net, not the intended path.
    await fEval("async ([f,v]) => { await cur_frm.set_value(f, v); }", [fn, query]);
    await hold(400);
    await setFieldRing(null, 0);
    return;
  }

  await hold(500); // dwell on the open dropdown so the viewer can read it
  const optSel = `${listSel} li[role="option"]`;
  const optRect = await F().evaluate(([s, idx]) => {
    const items = document.querySelectorAll(s);
    const el = items[idx];
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
  }, [optSel, pick]);
  if (optRect) {
    await setCursorType("pointer");
    await glide(optRect.cx, optRect.cy, 420);
    await ripple(340);
    await setCursorType("default");
    await F().evaluate(([s, idx]) => { document.querySelectorAll(s)[idx]?.click(); }, [optSel, pick]);
  }
  // Clicking the option fires Link's own select handler, which calls
  // set_value and runs fetch_from/dependent-field triggers asynchronously —
  // give those a moment to land before the closing dwell, same settle window
  // networkidle-style waits elsewhere in this harness use for post-fetch state.
  await F().waitForLoadState("networkidle").catch(() => {});
  await hold(500);
  await setFieldRing(null, 0);
}
// Set a field INSIDE a currently-open grid row (e.g. a child table row opened
// via row.toggle_view(true)) -- cur_frm.set_value only knows the parent
// doctype's own top-level fields and throws "fieldname does not exist in the
// form" for a child-table field, because the child row's fields live in the
// open row's OWN form object (grid_row.grid_form.fields_dict), not the parent
// form's fields_dict. Updates the child doc via frappe.model.set_value, which
// is what the grid row's own bound inputs do internally, so both the open row
// form and the grid's summary view reflect the change the same way a real
// user's edit would.
async function setGridField(tableFieldname, fn, val) {
  const sel = `.grid-row-open [data-fieldname="${fn}"]`;

  // Skip if the open row's field already has this exact value (e.g. a
  // default or a fetch_from already populated it) -- same rationale as
  // setField's skip-if-already-set.
  const existing = await F().evaluate(([t, f]) => {
    try {
      const grid = cur_frm.get_field(t).grid;
      const row = grid.grid_rows[grid.grid_rows.length - 1];
      return row.doc[f];
    } catch (e) { return undefined; }
  }, [tableFieldname, fn]).catch(() => undefined);
  if (existing !== undefined && existing !== null && String(existing).trim() === String(val).trim()) {
    return;
  }

  await setCursorType("default");
  const r = await rectOf(sel);
  if (r) await glide(r.x + r.w * 0.25, r.cy, 420);

  const ft = await F().evaluate(([t, f]) => {
    try {
      const grid = cur_frm.get_field(t).grid;
      const row = grid.grid_rows[grid.grid_rows.length - 1];
      return row.grid_form.fields_dict[f].df.fieldtype;
    } catch (e) { return null; }
  }, [tableFieldname, fn]).catch(() => null);

  const setOnce = (v) => fEval(
    "async ([t, f, v]) => { const grid = cur_frm.get_field(t).grid; const row = grid.grid_rows[grid.grid_rows.length - 1]; await frappe.model.set_value(row.doc.doctype, row.doc.name, f, v); }",
    [tableFieldname, fn, v]
  );

  const str = String(val);
  if (TYPED_FIELDTYPES.has(ft) && str.length > 0 && str.length <= 40) {
    const perChar = Math.max(28, Math.min(55, Math.round(380 / str.length)));
    for (let i = 1; i <= str.length; i++) {
      await setOnce(str.slice(0, i));
      // Re-measure every keystroke, same rationale as setField: the grid
      // row can reflow (currency width, validation text) while typing.
      const liveR = await rectOf(sel);
      if (liveR) {
        await setFieldRing(liveR, 0.9);
        await setCursorInFrame(liveR.x + liveR.w * 0.25, liveR.cy);
      }
      await cap();
      await dup(framesFor(perChar) - 1);
    }
    await setOnce(val);
  } else {
    const hr = await rectOf(sel);
    if (hr) await setFieldRing(hr, 0.9);
    await setOnce(val);
  }
  const finalR = await rectOf(sel);
  if (finalR) await setFieldRing(finalR, 0.9);
  await hold(480);
  await setFieldRing(null, 0);
}
// Close an open grid row (e.g. after setGridField calls) before saving the
// parent form. A real user always collapses or clicks away from an open row
// before hitting Save; leaving it open and calling cur_frm.save() directly was
// observed to occasionally leave the form permanently dirty (is_dirty() never
// clears, saveForm()'s own wait then times out) -- not reliably reproducible
// in isolation, but toggle_view(false) is the same call Frappe's own
// Escape-key/click-away handler makes, so this is both the realistic
// on-camera action AND removes whatever edge case the open row was causing.
// Always call this before saveForm() when the preceding steps used
// setGridField -- don't call cur_frm.save() with a row still open.
async function closeGridRow(tableFieldname) {
  await F().evaluate((t) => {
    const grid = cur_frm.get_field(t).grid;
    const row = grid.grid_rows[grid.grid_rows.length - 1];
    if (row) row.toggle_view(false);
  }, tableFieldname).catch(() => {});
  await hold(400);
}
// Opens a row to edit in a child table, adding one via "Add Row" ONLY if
// there isn't already a usable (empty, by keyFieldname) row to reuse.
// A fresh newDoc() can seed a child table with ONE EMPTY ROW ALREADY PRESENT
// (observed on Sales Order's "items") -- the table is not necessarily empty
// just because nothing has been typed into it yet. Blindly clicking
// ".grid-add-row" in that case leaves TWO rows: the original seeded one
// (still empty, so its mandatory fields fail validation) and the one you
// actually filled -- saveForm()'s cur_frm.save() then hangs/times out on the
// dangling empty row with no indication why. Always call this instead of
// clicking "Add Row" directly before a setGridField() sequence.
async function ensureGridRow(tableFieldname, keyFieldname) {
  const hasUsableRow = await F().evaluate(([t, k]) => {
    const rows = cur_frm.doc[t] || [];
    const last = rows[rows.length - 1];
    return rows.length > 0 && last && !last[k];
  }, [tableFieldname, keyFieldname]).catch(() => false);
  if (hasUsableRow) {
    // toggle_view(true) is safe even if the row is already open -- confirmed
    // in grid_row.js: it checks "if (open_row == this) already open, do
    // nothing" internally, so no separate is-it-open check is needed.
    await F().evaluate((t) => {
      const grid = cur_frm.get_field(t).grid;
      const row = grid.grid_rows[grid.grid_rows.length - 1];
      if (row) row.toggle_view(true);
    }, tableFieldname).catch(() => {});
    await hold(400);
    return;
  }
  // No usable row -- click "Add Row" (.grid-add-row, confirmed in grid.js:
  // clicking it calls add_new_row(..., show=true), which opens the new row
  // automatically).
  const sel = `[data-fieldname="${tableFieldname}"] .grid-add-row`;
  await scrollToSel(sel, 600);
  const r = await rectOf(sel);
  if (!r) throw new Error("add-row button not found for " + tableFieldname);
  await setCursorType("pointer");
  await glide(r.cx, r.cy, 460);
  await settleOnLive(sel, r);
  await hoverDwell();
  await ripple(360);
  await setCursorType("default");
  await clickVisible(sel);
  await hold(500); // let the new row open and the grid-form render
}
// Reorders a child-table row by glide+drop gesture (cosmetic) while doing the
// REAL move through Frappe's own grid API (not fighting SortableJS's native
// drag-event internals, which this harness's "cursor is cosmetic, the action
// is driven in JS" rule says not to simulate anyway — see "The cursor is
// cosmetic only" above). Grid rows use SortableJS with `handle:
// ".sortable-handle"` (confirmed in grid.js/grid_row.js: `.row-index` carries
// that class) and its own onUpdate handler calls `grid.renumber_based_on_dom()`
// once the DOM order changes — so physically moving the `.grid-row` element
// in the DOM and then calling that SAME function produces an identical result
// to a real drag-drop (same reindex, same `<fieldname>_move` trigger), not a
// visual-only trick.
async function handleFrappeTableReorder(tableFieldname, fromIdx, toIdx) {
  if (fromIdx === toIdx) return;
  const rowSel = (i) => `[data-fieldname="${tableFieldname}"] .grid-row[data-idx="${i}"] .row-index`;
  const fromR = await rectOf(rowSel(fromIdx));
  if (!fromR) throw new Error(`handleFrappeTableReorder: no row at idx ${fromIdx}`);
  await setCursorType("pointer");
  await glide(fromR.cx, fromR.cy, 500);
  await ripple(340);
  await hold(250); // beat of "picking up" the row before it visibly moves

  const toR = await rectOf(rowSel(toIdx)) || fromR;
  await glide(toR.cx, toR.cy, 620); // the drag glide itself
  await ripple(340);
  await setCursorType("default");

  // Confirmed from grid.js: the sortable container is `.rows` (`$rows =
  // $(this.parent).find(".rows")`), SortableJS drags each row's OWN wrapper
  // element (appended into `.rows` as `this.grid_rows[ri].wrapper`), and
  // renumber_based_on_dom() re-derives idx by iterating `.rows .grid-row` in
  // DOM order -- so moving whichever direct child of `.rows` CONTAINS the
  // `.grid-row[data-idx]` element, then calling that same function, is
  // exactly what a real drag-drop produces, not an approximation of it.
  await F().evaluate(([t, from, to]) => {
    const grid = cur_frm.get_field(t).grid;
    const rowsContainer = $(grid.parent).find(".rows").get(0);
    if (!rowsContainer) return;
    const children = Array.from(rowsContainer.children);
    const findChild = (idx) => children.find((c) => {
      const gridRow = c.matches(".grid-row") ? c : c.querySelector(".grid-row");
      return gridRow && gridRow.getAttribute("data-idx") == idx;
    });
    const fromEl = findChild(from);
    const toEl = findChild(to);
    if (!fromEl || !toEl || fromEl === toEl) return;
    if (from < to) toEl.after(fromEl); else toEl.before(fromEl);
    grid.renumber_based_on_dom();
    grid.frm && grid.frm.dirty();
  }, [tableFieldname, fromIdx, toIdx]).catch(() => {});
  await hold(500); // settle on the new row order
}
// Toggle a check field: glide to it, ripple, and set it. Emphasis comes from where the
// cursor goes and how long you dwell — author those in run().
async function toggleCheck(fn) {
  await revealField(fn);
  const box = `[data-fieldname="${fn}"] label`;
  const r = await rectOf(box);
  if (!r) return;
  await setCursorType("pointer");
  await glide(r.x + 12, r.cy, 520);
  await settleOnLive(box, { cx: r.x + 12, cy: r.cy });
  await ripple();
  await fEval(`async () => { await cur_frm.set_value("${fn}", 1); }`);
  await hold(720); // show it checked
  await setCursorType("default");
}
// Switches the tab AND performs the visible click itself — do not rely on a
// later revealField(anchor) to be the thing that actually activates the tab.
// Without this, calling clickTab(label) with no anchor (or an anchor that
// turns out to be hidden/absent on some doctype) glides the cursor and ripples
// but the pane never switches, because nothing here used to call .click().
async function rectOfTabLabel(lbl) {
  return F().evaluate((l) => {
    const t = [...document.querySelectorAll(".form-tabs .nav-link")].find((x) => x.innerText.trim().includes(l));
    if (!t) return null;
    const b = t.getBoundingClientRect();
    return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
  }, lbl);
}
async function clickTab(label, anchor) {
  const r = await rectOfTabLabel(label);
  if (r) {
    await setCursorType("pointer");
    await glide(r.cx, r.cy, 500);
    // re-check right before the real click — a toast or a sibling reflow
    // during the glide/ripple can shift the tab strip just enough that the
    // ripple lands beside the tab instead of on it.
    const live = await rectOfTabLabel(label);
    if (live && (Math.hypot(live.cx - r.cx, live.cy - r.cy) > 4)) await glide(live.cx, live.cy, 160);
    await hoverDwell();
    await ripple(360);
    await F().evaluate((lbl) => {
      const t = [...document.querySelectorAll(".form-tabs .nav-link")].find((x) => x.innerText.trim().includes(lbl));
      t?.click();
    }, label).catch(() => {});
    await setCursorType("default");
  }
  if (anchor) await revealField(anchor);
  await hold(320);
}
async function saveForm() {
  // A caller re-invoking saveForm() defensively (e.g. after an uncertain
  // prior state) on a doc that's ALREADY clean used to still glide to Save
  // and click it again — harmless on a submittable doctype (save is
  // idempotent there) but on a non-submittable one with no later submit step
  // this was the visible "Save clicked multiple times" defect: nothing
  // changed on screen between clicks, so repeat clicks just reads as the
  // recording stuttering. Skip the whole click when there is nothing to save.
  const alreadyClean = await F().evaluate(() => window.cur_frm && !cur_frm.is_dirty() && !cur_frm.is_new())
    .catch(() => false);
  if (alreadyClean) { await hold(300); return; }
  // The page-head toolbar can still be mid-rerender right after a fresh
  // navigation (e.g. the previous doctype's buttons not yet swapped out for
  // the new one's), so a single glideToSel() measured once before the ripple
  // can settle on a stale rect and visibly click beside the real Save
  // button. Re-measure live immediately before the ripple, exactly like
  // submitForm() already does for its modal button.
  const SEL = ".page-head .primary-action";
  const r0 = await rectOf(SEL);
  if (!r0) throw new Error("saveForm: Save button not found in page head (.page-head .primary-action)");
  await setCursorType("pointer");
  await glide(r0.cx, r0.cy, 460);
  const live = await settleOnLive(SEL, r0);
  await hoverDwell();
  await ripple(340);
  await setCursorType("default");
  // CLICK THE REAL BUTTON — this used to ripple near the button purely for
  // show, then call cur_frm.save() via fEval completely independently of
  // that click, meaning no real click ever reached the page: a confirmed,
  // real bug (not hypothetical), reported directly from watching a render —
  // the Save ripple animates but the actual save is invisible/disconnected
  // from it. Clicking the real `.page-head .primary-action` button fires
  // Frappe's OWN click handler, which itself calls cur_frm.save() — the
  // video now shows the actual cause of the save, not a cosmetic coincidence
  // next to an unrelated background action.
  const clickSave = () => clickVisible(SEL);
  await clickSave();
  // IMPORTANT: on a validation failure (a missing mandatory field a custom
  // validate() checks for, NOT necessarily one `reqd: 1` in the schema --
  // confirmed on Sales Order's validate_delivery_date(), which throws even
  // though delivery_date isn't marked reqd anywhere), cur_frm.save()'s own
  // promise NEVER RESOLVES OR REJECTS. Frappe shows a "Missing Fields" dialog
  // and the save() call just hangs forever waiting for a user to fix the
  // field and retry -- verified directly: the save() promise was still
  // pending 8+ seconds after a confirmed-open ".modal.show" dialog appeared.
  // Poll for either outcome (cur_frm clean, or a validation dialog open)
  // instead of awaiting a promise directly — clicking the real button means
  // there is no promise reference to await in the first place, and this
  // poll is also immune to the hang the old fEval-based approach needed a
  // short timeout to detect.
  let dialogText = null;
  try {
    await F().waitForFunction(() => {
      if (window.cur_frm && !cur_frm.is_dirty() && !cur_frm.is_new()) return true;
      return !!document.querySelector(".modal.show");
    }, null, { timeout: 15000 });
    dialogText = await F().evaluate(() => {
      const modal = document.querySelector(".modal.show");
      if (!modal) return null;
      const title = modal.querySelector(".modal-title")?.textContent?.trim();
      const body = modal.querySelector(".modal-body")?.textContent?.trim().slice(0, 300);
      return [title, body].filter(Boolean).join(": ");
    }).catch(() => null);
  } catch (e) {
    throw new Error(`saveForm: clicked Save but the form never settled and no dialog appeared either — ${e.message}`);
  }
  if (dialogText) {
    throw new Error(
      `saveForm: clicking Save opened a validation dialog instead of saving — "${dialogText}". ` +
      `This usually means a field a custom validate() requires wasn't set (schema's reqd:1 doesn't always ` +
      `cover this — see get-schema.py's documented limitations). Set that field in the storyboard and retry.`
    );
  }
  try {
    await F().waitForFunction(() => window.cur_frm && !cur_frm.is_dirty(), null, { timeout: 2000 });
  } catch (e) {
    // Observed occasionally (not reliably reproducible in isolation): saving
    // right after closing an open child-table grid row can leave is_dirty()
    // stuck true even though the save itself went through without error. One
    // retry — a real click on the SAME real button, same as a real user
    // hitting Save twice — has always cleared it in testing. If you call
    // saveForm() right after a grid-row edit, close the row first
    // (row.toggle_view(false)) -- a real user always does, and it removes
    // most of what triggers this.
    await clickSave();
    await F().waitForFunction(() => window.cur_frm && !cur_frm.is_dirty(), null, { timeout: 15000 });
  }
  await hold(900);
}
async function submitForm() {
  // CLICK THE REAL "Submit" BUTTON — this used to call cur_frm.savesubmit()
  // directly via fEval with NO click on the page at all, then only click the
  // confirm MODAL's own "Yes" button once it appeared. A real, confirmed bug
  // (not hypothetical), reported directly from watching a render: the video
  // never showed the actual Submit button being clicked — a confirm dialog
  // just appeared on screen with no visible cause. cur_frm.savesubmit()
  // itself still can't be awaited directly (its promise hangs forever on the
  // confirm dialog — see submitForm's long-standing own history on this),
  // but clicking the REAL button and then waiting for the resulting modal
  // sidesteps that without ever needing to call savesubmit() via fEval at
  // all — Frappe's own click handler on that button is what calls it.
  const SUBMIT_SEL = ".page-head .primary-action";
  const r0 = await rectOf(SUBMIT_SEL);
  if (!r0) throw new Error("submitForm: Submit button not found in page head (.page-head .primary-action)");
  await setCursorType("pointer");
  await glide(r0.cx, r0.cy, 460);
  await settleOnLive(SUBMIT_SEL, r0);
  await hoverDwell();
  await ripple(340);
  await setCursorType("default");
  await clickVisible(SUBMIT_SEL);
  const BTN = ".modal.show .btn-modal-primary, .modal.show .modal-footer .btn-primary";
  await F().waitForFunction((s) => document.querySelector(s), BTN, { timeout: 12000 });
  await sleep(300);
  const r = await rectOf(BTN);
  if (r) {
    await setCursorType("pointer");
    await glide(r.cx, r.cy, 420);
    await settleOnLive(BTN, r); // modal can finish animating in after the glide starts
    await hoverDwell();
    await ripple(340);
    await setCursorType("default");
  }
  await clickVisible(BTN);
  await F().waitForFunction(() => window.cur_frm && cur_frm.doc && cur_frm.doc.docstatus === 1, null, { timeout: 25000 });
  await hold(900);
}
// Checks for an UNEXPECTED modal/dialog (a validation error, a confirmation
// prompt neither saveForm() nor submitForm() already knows to wait for — e.g.
// "Item code matches an existing template. Use its variant settings?") and, if
// one is open, captions its message, clicks its primary action, and returns
// true so the caller knows a detour happened. This is NOT a background
// poller — this harness has no concurrent execution, run() is strictly
// sequential — so call it explicitly right after an action that might trigger
// a dialog you didn't plan for (a save, a status change, a custom button).
// Expected dialogs (submitForm's own confirm) should keep using their own
// direct selector/wait, not this — this is for the UNPLANNED case.
// `.modal.show .btn-modal-primary` is the same generic selector submitForm()
// already uses for its OWN confirm dialog (see `dialog.js`'s
// `standard_actions.find(".btn-modal-primary")` — Frappe's own dialogs all
// render this way), so it works for any Frappe dialog, not a specific one.
// A plain informational/error dialog (frappe.throw/frappe.msgprint with no
// confirm action — e.g. "Missing Fields", "Duplicate Entry") renders NO
// `.btn-modal-primary` at all, only the modal's own close ("X") icon in its
// header (`.modal-header .btn-modal-close`, every Frappe dialog's standard
// close button — see dialog.js's header markup). The old version here only
// ever looked for a primary-action button, so a pure-error dialog with none
// was silently left open on screen with nothing clicked — the "close the
// error however the framework actually closes it" defect. Prefer a real
// primary action when the dialog has one (it's the more meaningful action —
// e.g. "Yes"/"Continue" on a confirm prompt); fall back to the close icon for
// an informational dialog that has only that.
async function interceptFrappeModals({ timeoutMs = 1500, captionIt = true } = {}) {
  const sel = ".modal.show";
  const btnSel = ".modal.show .btn-modal-primary, .modal.show .modal-footer .btn-primary";
  // .btn-modal-close is the real, current Frappe selector (frappe.get_modal()
  // in dom.js builds it with exactly this class; dialog.js's get_close_btn()
  // confirms it as the canonical lookup) — NOT ".modal-header .close", which
  // is plain Bootstrap markup Frappe does not use. [data-dismiss="modal"] is
  // kept only as a second-chance fallback, same attribute the button also carries.
  const closeSel = ".modal.show .btn-modal-close, .modal.show [data-dismiss=\"modal\"]";
  const appeared = await F().waitForFunction((s) => document.querySelector(s), sel, { timeout: timeoutMs })
    .then(() => true).catch(() => false);
  if (!appeared) return false;

  const text = await F().evaluate(() => {
    const title = document.querySelector(".modal.show .modal-title");
    const body = document.querySelector(".modal.show .modal-body");
    const t = title ? title.textContent.trim() : "";
    const b = body ? body.textContent.trim().slice(0, 140) : "";
    return [t, b].filter(Boolean).join(": ");
  }).catch(() => "");

  if (captionIt && text) await caption(text, 1800);
  await hold(400);

  let r = await rectOf(btnSel);
  let clickSel = btnSel;
  if (!r) { r = await rectOf(closeSel); clickSel = closeSel; }
  if (r) {
    await setCursorType("pointer");
    await glide(r.cx, r.cy, 460);
    await settleOnLive(clickSel, r);
    await hoverDwell();
    await ripple(360);
    await setCursorType("default");
    await clickVisible(clickSel);
  }
  await hold(500);
  return true;
}
// Opens a document from its list view by row index (0 = first row). Generic to
// every doctype: the list view's row click handler (list_view.js) resolves
// $row.find(".list-subject a") and frappe.set_route(link.pathname) — same
// class names on every doctype's list, not Item-specific. Call gotoApp on the
// list route first (e.g. "/app/item"), then this.
async function rectOfListRow(index) {
  return F().evaluate((i) => {
    const links = document.querySelectorAll(".list-row .list-subject a");
    const el = links[i];
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
  }, index);
}
async function clickListRow(index = 0) {
  const r = await rectOfListRow(index);
  if (!r) {
    // A real, confirmed cause for index 0 specifically: Frappe list views
    // persist the LAST-USED standard filter values per doctype per user
    // across the whole session (frappe.get_user_settings) — a leftover
    // filter from browsing a DIFFERENT but related doctype earlier in the
    // same run can silently zero out this list's rows. Surface that
    // possibility directly in the error instead of a bare "no row" that
    // reads like a selector bug — call clearListFilters() and retry if this
    // is what happened.
    const hasFilterX = await F().evaluate(() => !!document.querySelector(".filter-x-button")).catch(() => false);
    const hint = hasFilterX
      ? " A stray standard filter left over from an earlier doctype this run may be hiding all rows — try clearListFilters() first."
      : "";
    throw new Error("no list row at index " + index + hint);
  }
  await setCursorType("pointer");
  await glide(r.cx, r.cy, 500);
  // the list can re-sort/re-render rows (e.g. a background refresh) during
  // the glide — re-check before the ripple so it lands on the row that's
  // actually there now, not where row `index` was when first measured.
  const live = await rectOfListRow(index);
  if (live && Math.hypot(live.cx - r.cx, live.cy - r.cy) > 4) await glide(live.cx, live.cy, 160);
  await hoverDwell();
  await ripple(360);
  await setCursorType("default");
  await F().evaluate((i) => {
    document.querySelectorAll(".list-row .list-subject a")[i].click();
  }, index);
}

// ------------------------------------------------- custom buttons & async steps
// Frappe renders custom buttons into .custom-actions with a URI-ENCODED data-label, so
// they are addressable without matching on text; grouped ones sit inside
// .inner-group-button[data-label="<group>"] > button, with the items in its .dropdown-menu.
const dl = (label) => encodeURIComponent(label).replace(/'/g, "%27");

// Opens a document's print preview the way a real user does: click the
// form's own Print icon (sidebar), which does a same-tab SPA route change to
// the desk print page `/app/<doctype>/print/<name>`, then click that page's
// real "Full Page" button, which opens the standalone `/printview` page in a
// NEW tab (verified against current Frappe source: form_sidebar.js's
// setup_print() wires the icon to frm.print_doc(), which calls
// frappe.set_route("print", doctype, name) — no dialog, no window.open at
// this step; form.js's print_doc()). This replaces jumping straight to
// `/printview?...` with a raw gotoApp — correct for a storyboard that should
// read as "a person using the app," not "a developer hitting a URL."
// Caller must already be ON the document (newDoc()/clickListRow() etc. already
// leave the frame there). Returns the new tab's Page so the caller can choose
// to keep rendering from it or close it and fall back to gotoApp("/printview...").
// Remembers the form URL openPrintView() was called from, so a caller that's
// done with the print beat can get back to the actual document afterward —
// see closeExtraTab's note on why this is needed, not optional.
let lastFormUrl = null;
async function openPrintView() {
  // The form's own page URL BEFORE the print icon navigates the app iframe
  // away from it (frm.print_doc() does a SAME-TAB SPA route change to the
  // desk print page — see the comment below) — the one thing a caller needs
  // to get back to the form later, since nothing else records it.
  lastFormUrl = await F().evaluate(() => location.href).catch(() => null);
  // The real button has title="" with the actual tooltip text in
  // data-original-title (Bootstrap tooltip convention — confirmed by
  // inspecting a live site's rendered DOM: `<button ... title=""
  // data-original-title="Print">`), so a `[title="Print"]` selector matches
  // NOTHING — this was a real, verified bug, not a hypothetical one.
  const ICON_SEL = '.form-sidebar .form-print .icon-btn, .form-sidebar button[data-original-title="Print"]';
  const r = await rectOf(ICON_SEL);
  if (!r) throw new Error("openPrintView: print icon not found in form sidebar (is the doctype printable / saved?)");
  await setCursorType("pointer");
  await glide(r.cx, r.cy, 480);
  await settleOnLive(ICON_SEL, r);
  await hoverDwell();
  await ripple(360);
  await setCursorType("default");
  await clickVisible(ICON_SEL);
  await F().waitForFunction(() => location.pathname.includes("/print/"), null, { timeout: 15000 });
  await F().waitForFunction(() => document.querySelector(".print-preview, .print-format"), null, { timeout: 15000 }).catch(() => {});
  await hold(500);

  // Verified directly against a live site's rendered DOM: the desk print
  // page's toolbar (Full Page / PDF / Refresh / Print) is the same espresso
  // (es-*) component used everywhere else in the current desk, NOT Bootstrap
  // `.btn` — the real markup is `<button class="es-button ellipsis">Full
  // Page</button>` with no `.print-preview-wrapper`/`.btn` ancestor at all.
  // A `.print-preview-wrapper .btn` selector (the old version here) matches
  // NOTHING on a real site — this was a real, confirmed bug (caught because
  // a render failed with "Full Page button not found" even though the
  // button was plainly visible in the captured frame), not a hypothetical
  // one. Match by visible text across every `.es-button` instead.
  const fullPageRect = await F().evaluate(() => {
    const btn = [...document.querySelectorAll(".es-button")]
      .find((b) => b.textContent.trim().toLowerCase() === "full page");
    if (!btn) return null;
    const b = btn.getBoundingClientRect();
    btn.setAttribute("data-demo-full-page", "1");
    return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
  }).catch(() => null);
  if (!fullPageRect) throw new Error('openPrintView: "Full Page" button not found on desk print page');

  await glide(fullPageRect.cx, fullPageRect.cy, 420);
  await hoverDwell();
  await ripple(340);
  const [newPage] = await Promise.all([
    page.context().waitForEvent("page", { timeout: 15000 }),
    F().evaluate(() => document.querySelector('[data-demo-full-page="1"]')?.click()),
  ]);
  await newPage.waitForLoadState("domcontentloaded").catch(() => {});
  await newPage.waitForFunction(() => document.querySelector(".print-format"), null, { timeout: 20000 }).catch(() => {});
  return newPage;
}

// "Back to the list view" the way a real user does it: click the doctype's
// own breadcrumb link at the top of the form, not a cold gotoApp to the list
// route. Verified against current Frappe source (breadcrumbs.js): the crumb
// trail renders as `nav.es-breadcrumbs` with each segment an
// `a.es-breadcrumbs__item` (current doc name is the LAST crumb and has no
// href — it's a plain span, not a link); the doctype's own crumb is
// genuinely the first `<li>`'s anchor, pointing at `/desk/<doctype-slug>`.
// This is generic to every doctype — the breadcrumb builder takes the
// doctype name from frappe.ui.form.get_breadcrumbs(), not anything
// payroll/HR-specific.
// Opens the navbar's global search ("AwesomeBar") the way a real user does:
// click the search trigger, type into the real input, and let its own
// Awesomplete dropdown route the click — instead of a cold gotoApp straight
// to a list/new-doc URL. Verified against current Frappe source
// (awesome_bar.js/search_utils.js): the trigger is `.navbar-modal-search-mobile`
// (desk pages) or `.search-widget-wrapper #search-widget-button` (desktop
// home), both opening a Bootstrap modal with input `#navbar-search`, whose
// typed text drives a real `.awesomplete li` dropdown. Typing "new <doctype>"
// surfaces a literal "New <Doctype>" result (NOT "Create a new..." — verified
// the exact label text) that calls frappe.new_doc() when selected; a bare
// doctype name instead surfaces a result that routes to its list view. Generic
// to any doctype — nothing here is hardcoded to one module.
async function openSearch() {
  const TRIGGER = ".navbar-modal-search-mobile, .search-widget-wrapper #search-widget-button";
  // The search trigger lives on the STAGE page's app iframe document same as
  // any other desk chrome, so F() (not page.evaluate) is correct here.
  const r = await rectOf(TRIGGER);
  if (r) {
    await setCursorType("pointer");
    await glide(r.cx, r.cy, 420);
    await hoverDwell();
    await ripple(320);
    await setCursorType("default");
    await clickVisible(TRIGGER);
  } else {
    // Ctrl/Cmd+K also opens it — used as a fallback when the icon isn't
    // present in the current navbar layout (e.g. narrower breakpoints).
    await F().evaluate(() => document.querySelector("body")?.focus());
    await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  }
  await F().waitForFunction(() => document.querySelector("#navbar-search"), null, { timeout: 8000 });
  await hold(350);
}
async function typeIntoSearch(text) {
  const SEL = "#navbar-search";
  const r = await rectOf(SEL);
  if (r) await glide(r.cx, r.cy, 300);
  await F().evaluate((s) => document.querySelector(s)?.focus(), SEL);
  const perChar = Math.max(30, Math.min(55, Math.round(380 / Math.max(text.length, 1))));
  for (let i = 1; i <= text.length; i++) {
    const partial = text.slice(0, i);
    await F().evaluate(([s, v]) => {
      const el = document.querySelector(s);
      if (!el) return;
      const proto = Object.getPrototypeOf(el);
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, [SEL, partial]);
    await cap();
    await dup(framesFor(perChar) - 1);
  }
  await hold(300);
}
// Picks a result row from the open awesomplete dropdown whose visible text
// includes `matchText` (case-insensitive) — e.g. "New Sales Order" or just
// "Sales Order" for the plain list-route result.
async function selectSearchResult(matchText) {
  const r = await F().evaluate((needle) => {
    const items = [...document.querySelectorAll(".awesomplete li, .awesomplete ul[role=\"listbox\"] li")];
    const el = items.find((li) => li.textContent.trim().toLowerCase().includes(needle.toLowerCase()));
    if (!el) return null;
    const b = el.getBoundingClientRect();
    el.setAttribute("data-demo-search-pick", "1");
    return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
  }, matchText).catch(() => null);
  if (!r) throw new Error(`selectSearchResult: no dropdown row matching "${matchText}"`);
  await setCursorType("pointer");
  await glide(r.cx, r.cy, 380);
  await hoverDwell();
  await ripple(320);
  await setCursorType("default");
  await F().evaluate(() => document.querySelector('[data-demo-search-pick="1"] a, [data-demo-search-pick="1"]')?.click());
}
// Full "go to a doctype's list via the real search box" flow.
async function searchAndOpenDoctype(dt) {
  await openSearch();
  await typeIntoSearch(dt);
  await F().waitForFunction(() => document.querySelectorAll(".awesomplete li").length > 0, null, { timeout: 8000 }).catch(() => {});
  await hold(300);
  await selectSearchResult(dt);
  await F().waitForFunction(() => document.querySelector(".list-row"), null, { timeout: 20000 }).catch(() => {});
  await hold(500);
}
// Clicks a linked-document entry in a submitted document's own DASHBOARD —
// the "Connections" tab's `.document-link` widgets (each showing a doctype
// name and a badge count of how many such documents link back to this one,
// e.g. "Loan Repayment Schedule  1" on a Loan Disbursement) — verified
// directly against a live site. This is the REAL, generic way Frappe lets a
// user navigate from a document to things created FROM it, and it is
// GENUINELY better than search+filter for this: clicking the badge link
// navigates straight to the linked list ALREADY filtered by the correct
// relationship (confirmed: clicking "Loan Repayment Schedule" on a Loan
// Disbursement's dashboard lands on
// `/desk/.../loan-repayment-schedule/view/list?loan_disbursement=<name>` —
// the filter is set correctly and automatically, nothing to type or clear).
// Prefer this over `searchAndOpenDoctype` + manual filtering whenever the
// doctype you're navigating TO is one the CURRENT document's own dashboard
// already links to — it's both more realistic (a user who just submitted a
// Loan Disbursement looks at ITS dashboard next, not the global search) and
// more robust (no stray-filter hazard — see `clearListFilters()`'s own
// comment on that class of bug). Not every doctype has a dashboard, and not
// every navigation should go through one — use `searchAndOpenDoctype`/
// `searchAndCreateNew` for anything the current document doesn't actually
// link to.
async function clickDashboardLink(doctypeLabel) {
  // The Connections tab may need an explicit click to become the active
  // pane first — `clickTab` already handles a tab that's not yet shown.
  const onConnections = await F().evaluate(() =>
    !!document.querySelector('.form-tabs .nav-link.active')?.textContent?.trim().match(/connections/i)
  ).catch(() => false);
  if (!onConnections) {
    const hasConnTab = await F().evaluate(() =>
      [...document.querySelectorAll(".form-tabs .nav-link")].some((t) => /connections/i.test(t.textContent))
    ).catch(() => false);
    if (hasConnTab) await clickTab("Connections");
  }
  const sel = `.document-link[data-doctype="${doctypeLabel.replace(/"/g, '\\"')}"] .badge-link`;
  const r = await rectOf(sel);
  if (!r) throw new Error(`clickDashboardLink: no dashboard link for "${doctypeLabel}" on this document (does it actually link here?)`);
  await setCursorType("pointer");
  await glide(r.cx, r.cy, 440);
  await settleOnLive(sel, r);
  await hoverDwell();
  await ripple(340);
  await setCursorType("default");
  await clickVisible(sel);
  await F().waitForFunction(() => document.querySelector(".list-row, .form-layout"), null, { timeout: 20000 }).catch(() => {});
  await hold(500);
}
// Clicks a list view's own primary "+ Add <Doctype>" button in the page
// head (`.page-head .primary-action`) — the real way a user creates a new
// document FROM a list they're already looking at, as opposed to `newDoc()`
// jumping straight to a `/new` URL. Caller must already be on the list view.
async function clickListAddButton(dt) {
  const ADD_SEL = ".page-head .primary-action";
  // The list view's own page-head can still be mid-render right after
  // arriving via search (the previous screen's toolbar swapping out for
  // this doctype's) — wait for the real readiness signal instead of
  // measuring immediately, same class of race `gotoApp`/`waitForm` already
  // guard against elsewhere.
  await F().waitForFunction((s) => {
    const el = document.querySelector(s);
    return el && el.getBoundingClientRect().width > 0;
  }, ADD_SEL, { timeout: 15000 }).catch(() => {});
  const r = await rectOf(ADD_SEL);
  if (!r) throw new Error("clickListAddButton: no list-view Add button found for " + dt);
  await setCursorType("pointer");
  await glide(r.cx, r.cy, 420);
  await settleOnLive(ADD_SEL, r);
  await hoverDwell();
  await ripple(340);
  await setCursorType("default");
  await clickVisible(ADD_SEL);
  await F().waitForFunction(() => window.frappe && frappe.boot, null, { timeout: 25000 });
  await waitForm(dt);
  await F().waitForLoadState("networkidle").catch(() => {});
  await hold(300);
}
// Full "create a new document via the real search box's quick-create" flow —
// types "new <doctype>" and picks the literal "New <Doctype>" result, exactly
// the flow a real user follows instead of a bare /new URL. Falls back to the
// plain doctype search + the list view's own "+ Add" button when the typed
// quick-create phrasing doesn't surface a match (some doctypes are excluded
// from quick-create by permission or naming collisions).
async function searchAndCreateNew(dt) {
  await openSearch();
  await typeIntoSearch("new " + dt);
  await F().waitForFunction(() => document.querySelectorAll(".awesomplete li").length > 0, null, { timeout: 8000 }).catch(() => {});
  await hold(300);
  const hasCreateRow = await F().evaluate((label) => {
    return [...document.querySelectorAll(".awesomplete li")]
      .some((li) => li.textContent.trim().toLowerCase() === label.toLowerCase());
  }, "New " + dt).catch(() => false);
  if (hasCreateRow) {
    await selectSearchResult("New " + dt);
    await F().waitForFunction(() => window.frappe && frappe.boot, null, { timeout: 25000 });
    await waitForm(dt);
    await F().waitForLoadState("networkidle").catch(() => {});
    await hold(300);
  } else {
    // fallback: close the dropdown, search the bare doctype name to its list,
    // then use the list view's own primary "+ Add" button — still the real
    // UI, just the list-view path rather than the awesome-bar quick-create.
    await F().evaluate(() => document.querySelector("#navbar-search")?.blur());
    await openSearch();
    await typeIntoSearch(dt);
    await F().waitForFunction(() => document.querySelectorAll(".awesomplete li").length > 0, null, { timeout: 8000 }).catch(() => {});
    await selectSearchResult(dt);
    await F().waitForFunction(() => document.querySelector(".list-row, .page-head"), null, { timeout: 20000 }).catch(() => {});
    await clickListAddButton(dt);
  }
}
async function backToListView() {
  const SEL = "nav.es-breadcrumbs a.es-breadcrumbs__item:first-child";
  const r = await rectOf(SEL);
  if (!r) throw new Error("backToListView: breadcrumb link not found (not on a form, or breadcrumbs hidden)");
  await setCursorType("pointer");
  await glide(r.cx, r.cy, 460);
  await settleOnLive(SEL, r);
  await hoverDwell();
  await ripple(340);
  await setCursorType("default");
  await clickVisible(SEL);
  await F().waitForFunction(() => document.querySelector(".list-row"), null, { timeout: 20000 }).catch(() => {});
  await hold(500);
}

// Switches a list view between List/Report/Dashboard/Gantt/Kanban/Calendar —
// verified directly against a live site's rendered DOM. The trigger is
// `.view-switcher .es-button` (parent wrapper `div.custom-btn-group
// .view-switcher`), opening the SAME kind of dynamically-built `.es-menu`
// panel `clickGroupItem` already drives, with rows (`.es-menu__item`) in
// plain text — "List View", "Report View", "Dashboard View", "Gantt View",
// "Kanban View", "Calendar View". Which of these appear is conditional on
// the doctype (Report/Calendar/Kanban only show if the doctype supports
// them) — this is generic to any list view, not hardcoded to one doctype.
// Caller must already be on a list view (`gotoApp("/app/<doctype>")`, or
// land there via `backToListView()`/`searchAndOpenDoctype()`).
async function switchListView(viewLabel) {
  const TRIGGER = ".view-switcher .es-button";
  const r = await rectOf(TRIGGER);
  if (!r) throw new Error("switchListView: view-switcher button not found (not on a list view?)");
  await setCursorType("pointer");
  await glide(r.cx, r.cy, 460);
  await settleOnLive(TRIGGER, r);
  await hoverDwell();
  await ripple(340);
  await setCursorType("default");
  await clickVisible(TRIGGER);
  await hold(400);
  const findItem = () => F().evaluate((needle) => {
    const menus = [...document.querySelectorAll(".es-menu")].filter((m) => {
      const r = m.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    for (const m of menus) {
      const item = [...m.querySelectorAll(".es-menu__item")]
        .find((el) => el.textContent.trim().toLowerCase() === needle.toLowerCase());
      if (item) {
        const b = item.getBoundingClientRect();
        item.setAttribute("data-demo-view-pick", "1");
        return { cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
      }
    }
    return null;
  }, viewLabel).catch(() => null);
  const i = await findItem();
  if (!i) throw new Error(`switchListView: no menu row matching "${viewLabel}"`);
  await glide(i.cx, i.cy, 420);
  await hoverDwell();
  await ripple(340);
  await F().evaluate(() => document.querySelector('[data-demo-view-pick="1"]')?.click());
  await hold(500);
}
// Opens the list view's own "Filter" control (NOT the "..." more-actions
// menu — verified directly against a live site: the Filter toggle is a
// standalone, always-visible button, `.filter-selector .filter-button`,
// separate from the ellipsis menu entirely) and returns once its popover is
// open (`.filter-popover.popover .filter-edit-area`). Driving the actual
// filter-field pick itself is doctype-specific (which field, which
// operator, which value), so this primitive only gets the popover open and
// on screen — build the rest of the beat the same way `setField`/
// `setFrappeLinkField` drive any other form control, scoped to
// `.filter-popover` instead of the form.
async function toggleListFilter() {
  const SEL = ".filter-selector .filter-button";
  const r = await rectOf(SEL);
  if (!r) throw new Error("toggleListFilter: Filter button not found (not on a list view?)");
  await setCursorType("pointer");
  await glide(r.cx, r.cy, 420);
  await settleOnLive(SEL, r);
  await hoverDwell();
  await ripple(340);
  await setCursorType("default");
  await clickVisible(SEL);
  await F().waitForFunction(() => document.querySelector(".filter-popover.popover"), null, { timeout: 8000 }).catch(() => {});
  await hold(400);
}

// Clears every standard-filter field on a list view via its real "clear
// filters" (X) button — verified directly against a live site:
// `.filter-x-button` next to the Filter control. Frappe list views persist
// the LAST-USED standard filter values per doctype per user across sessions
// (`frappe.get_user_settings`/`view_user_settings` in list_view.js) — a real,
// documented behavior, not a harness bug, but a real hazard for this
// skill's reproducibility goal: confirmed directly on a live site, a
// standard filter left over from browsing a DIFFERENT but related doctype
// earlier in the same browser session (e.g. "Loan Disbursement" left in a
// "Loan Repayment Schedule" list's own `loan_disbursement` filter field) can
// silently zero out a list's rows, making `clickListRow(0)` throw "no list
// row at index 0" for a reason that has nothing to do with the row-open
// logic itself — the list is just filtered to nothing. Call this before
// relying on a list's default (unfiltered, newest-first) row order whenever
// the same browser session/user may have touched a related doctype earlier
// in the run.
async function clearListFilters() {
  const SEL = ".filter-x-button";
  const has = await F().evaluate((s) => !!document.querySelector(s), SEL).catch(() => false);
  if (!has) return; // nothing to clear
  const r = await rectOf(SEL);
  if (r) {
    await setCursorType("pointer");
    await glide(r.cx, r.cy, 380);
    await hoverDwell();
    await ripple(320);
    await setCursorType("default");
  }
  await clickVisible(SEL);
  await hold(500);
}

async function clickCustomButton(label) {
  const sel = `.custom-actions [data-label="${dl(label)}"]`;
  const r = await rectOf(sel);
  if (!r) throw new Error("custom button not found: " + label);
  await setCursorType("pointer");
  await glide(r.cx, r.cy, 560);
  await settleOnLive(sel, r);
  await hoverDwell();
  await ripple(380);
  await setCursorType("default");
  await clickVisible(sel);
}

// IMPORTANT, verified directly against a live site's rendered DOM (not just
// source-read): the dropdown's HIDDEN backing store (inside
// `.inner-group-button[data-label="<group>"] .dropdown-menu`) DOES carry a
// `data-label` on each `a.dropdown-item` — but that store is never the
// visible, clickable element. Opening the group button builds a FRESH,
// separate `.es-menu` panel (appended near <body>, positioned absolutely)
// from that store's current contents, and its rows (`.es-menu__item`,
// `<button>` elements) carry NO `data-label` or any matchable attribute at
// all — only their rendered text (split into a `.es-menu__mnemonic` span for
// the first letter plus the rest as a sibling text node, so match on the
// whole element's `textContent`, not a single child). A selector built
// against the hidden store's `data-label` (the old version of this function)
// silently matches zero elements once the menu is actually open — the two
// DOM subtrees are not the same nodes.
async function clickGroupItem(group, label) {
  const gsel = `.inner-group-button[data-label="${dl(group)}"] .es-button`;
  const g = await rectOf(gsel);
  if (!g) throw new Error("button group not found: " + group);
  await setCursorType("pointer");
  await glide(g.cx, g.cy, 560);
  await settleOnLive(gsel, g);
  await hoverDwell();
  await ripple(380);
  await clickVisible(gsel); // open the menu
  await hold(500); // dwell on the open menu (replaces a dead sleep+hold stack)
  // Find the open, visible .es-menu panel's row matching `label` by text —
  // there can be multiple .es-menu nodes in the DOM (other closed groups'
  // menus, submenus), so filter to ones actually laid out on screen.
  const findItem = () => F().evaluate((needle) => {
    const menus = [...document.querySelectorAll(".es-menu")].filter((m) => {
      const r = m.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    });
    for (const m of menus) {
      const item = [...m.querySelectorAll(".es-menu__item")]
        .find((el) => el.textContent.trim().toLowerCase() === needle.toLowerCase());
      if (item) {
        const r = item.getBoundingClientRect();
        item.setAttribute("data-demo-group-pick", "1");
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
      }
    }
    return null;
  }, label).catch(() => null);
  const i = await findItem();
  if (!i) throw new Error(`clickGroupItem: no visible menu row matching "${label}" in group "${group}"`);
  await glide(i.cx, i.cy, 460);
  const live = await findItem(); // menu items can shift while still animating open
  const target = live || i;
  if (live && Math.hypot(live.cx - i.cx, live.cy - i.cy) > 4) await glide(live.cx, live.cy, 160);
  await hoverDwell();
  await ripple(360);
  await setCursorType("default");
  await F().evaluate(() => document.querySelector('[data-demo-group-pick="1"]')?.click());
}

// Off-camera server-side step. Use this rather than trusting the bench's RQ worker: a
// long-running worker can hold stale bytecode and fail EVERY job (an ImportError in
// logs/worker.error.log) while the web server is fine, which stalls a take at a status
// that never advances. Running the job function (and any poller) inline from a small
// script keeps the render reproducible without restarting the user's bench.
function bench(script, ...args) {
  return execFileSync(path.join(BENCH, "env", "bin", "python"), [path.join(__dirname, script), ...args],
    { cwd: path.join(BENCH, "sites"), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// A feature whose buttons enqueue background jobs: click it, dwell on the "started in the
// background" toast, then advance the job off-camera so the video never waits on a cron.
// `bridgeText` names the time/process being skipped (e.g. "Running daily
// classification for the next 45 days…") — without it, a viewer sees a
// disbursed loan cut straight to an already-overdue DPD log with no
// indication that a scheduled job (not instant magic) produced that number.
// This was the "DPD showing immediately after disbursement" complaint: the
// underlying bench call is correct and necessarily off-camera (per "Features
// whose buttons enqueue background jobs" below), but a silent cut from
// before-state to after-state reads as broken/confusing rather than as "time
// passed." Always pass bridgeText for any off-camera step that advances date-
// driven state (classification, dunning, accrual) — it's optional only for
// steps whose effect is visually self-evident without narration.
async function asyncStep(group, label, script, bridgeText, ...args) {
  await clickGroupItem(group, label);
  await hold(2000);           // the toast (merged with the old dead sleep before it)
  if (bridgeText) await captionPersist(bridgeText);
  bench(script, ...args);     // what the worker + poller would have done
  if (bridgeText) await clearCaption();
  await reloadDoc();
  await hold(1500);           // the advanced status
}
// Same bridge, for off-camera steps NOT driven by a clickGroupItem (e.g. a
// scheduled job triggered by a bare bench() call with nothing to click first,
// such as classification/dunning runs in a reset-and-skip-ahead storyboard).
async function offCameraStep(bridgeText, fn) {
  if (bridgeText) await captionPersist(bridgeText);
  await fn();
  if (bridgeText) await clearCaption();
}

async function reloadDoc() {
  await fEval("async () => { await cur_frm.reload_doc(); }");
  await hold(500); // was a dead sleep — the caller's own hold() after this absorbs the rest
}

async function runReport(name, filters) {
  await F().waitForFunction(
    (n) => window.frappe && frappe.query_report && frappe.query_report.report_name === n
      && Array.isArray(frappe.query_report.filters) && frappe.query_report.filters.length > 0,
    name, { timeout: 25000 }
  ).catch(() => {});
  await hold(700); // the waitForFunction above is best-effort (catches), so this covers genuine settle
  try {
    await fEval("async (f) => { if (frappe.query_report && frappe.query_report.set_filter_value) await frappe.query_report.set_filter_value(f); if (frappe.query_report && frappe.query_report.refresh) await frappe.query_report.refresh(); }", filters, 12000);
  } catch (e) { console.log("report filter warning:", e.message); }
  await hold(500);
}
// Scroll the report's datatable body down (and settle back near the top) so rows
// below the fold are shown on camera instead of only a static hold on row 1.
async function scrollReportBody(downPx = 900, durMs = 900) {
  const sel = ".dt-scrollable, .datatable .dt-scrollable";
  const has = await F().evaluate((s) => !!document.querySelector(s), sel).catch(() => false);
  if (!has) return;
  await F().evaluate((s) => { window.__scrollTarget = document.querySelector(s); }, sel).catch(() => {});
  const cur = await F().evaluate((s) => document.querySelector(s).scrollTop, sel).catch(() => 0);
  await scrollToY(cur + downPx, durMs);
  await F().evaluate(() => { window.__scrollTarget = null; }).catch(() => {});
}


// ============================================================ flow executor
// Tracks every document this run actually CREATES (by doctype, in creation
// order) so (a) a later step can reference an earlier one's generated name
// via "{{Doctype.N}}" without knowing it in advance, and (b) --reset can
// delete every one of them generically afterward — no hand-written
// per-project reset-demo.py needed. Populated by newDoc/searchAndCreateNew
// (the two primitives that land on a FRESH, unsaved document) once saveForm/
// submitForm actually commits it (cur_frm.doc.name is a real name only after
// that, not immediately after newDoc — a new doc's name is a placeholder like
// "new-sales-order-xxxx" until the first save assigns the real one).
const createdDocs = []; // [{doctype, name}]
let pendingDoctype = null;
// Doctypes the flow has already navigated to at least once — gates the
// automatic "realistic opening" (see goToDoctypeRealistically below) so a
// flow creating several documents of the SAME doctype back to back doesn't
// repeat Home → Search → List before every single one; only the FIRST visit
// to a given doctype in a run gets the full realistic approach, exactly like
// a real user wouldn't re-search for something they're already looking at.
const visitedDoctypes = new Set();
// True only for the very first navigation of the whole flow — THAT one
// starts from the desk Home screen; every later doctype switch starts from
// wherever the previous step left off (a real user doesn't bounce back to
// Home between every doctype).
let isFirstNavigation = true;

function resolveTemplate(val) {
  if (typeof val === "string") {
    return val.replace(/\{\{\s*([^.}\s]+)\.(\d+)\s*\}\}/g, (_, dt, idxStr) => {
      const idx = parseInt(idxStr, 10);
      const matches = createdDocs.filter((d) => d.doctype === dt);
      const doc = matches[idx - 1];
      if (!doc) throw new Error(`resolveTemplate: no created doc "${dt}.${idx}" yet (only ${matches.length} "${dt}" doc(s) created so far)`);
      return doc.name;
    });
  }
  if (Array.isArray(val)) return val.map(resolveTemplate);
  if (val && typeof val === "object") {
    const out = {};
    for (const k of Object.keys(val)) out[k] = resolveTemplate(val[k]);
    return out;
  }
  return val;
}

async function recordIfNewlyCreated() {
  if (!pendingDoctype) return;
  const name = await F().evaluate(() => {
    try { return window.cur_frm && !cur_frm.is_new() ? cur_frm.doc.name : null; } catch (e) { return null; }
  }).catch(() => null);
  if (name) createdDocs.push({ doctype: pendingDoctype, name });
  pendingDoctype = null;
}

// Each key here is a step action name exactly as it appears in steps.json.
// The value is how that step's input maps onto the real primitive above —
// most are a direct passthrough (the input IS the primitive's argument);
// a few (setField, setGridField) accept a plain object of {fieldname: value}
// pairs so a storyboard author never has to call the same action N times.
const STEP_HANDLERS = {
  // "newDoc"/"searchAndCreateNew" both automatically do the REALISTIC
  // opening beat the first time a flow visits a given doctype — Home (only
  // for the very first navigation of the whole run) → real navbar search →
  // land on the doctype's list → create — instead of jumping straight to a
  // /new URL. This is a DEFAULT, not something a storyboard author has to
  // spell out as its own steps: "Create the Loan" in a plain-language flow
  // request should just become one {"newDoc": "Loan"} step, and this handler
  // is what makes that one step actually render as "search for Loan from the
  // home screen, open its list, then create" on screen. A later newDoc/
  // searchAndCreateNew call for a doctype ALREADY visited this run skips
  // straight to creating — a real user doesn't re-search for something
  // they're already looking at.
  async newDoc(dt) {
    // The FIRST time a flow visits `dt`, maybeOpenHomeAndSearchList lands on
    // its real list view (Home + search) — and the create step from there
    // MUST be a click on that list's own "+ Add <Doctype>" button
    // (clickListAddButton), not a bare newDoc() URL jump. A bare jump right
    // after arriving at the list was a real, confirmed bug: the list (and
    // its visible Add button) rendered on screen for a beat and then the
    // storyboard silently teleported past it via URL instead of clicking
    // the thing it just showed — reads as "the video skipped a step," not a
    // person using the app. newDoc()'s direct URL jump remains correct ONLY
    // when there's no list currently on screen to click an Add button from
    // — i.e. a SECOND newDoc() call for a doctype already visited this run,
    // where the previous step left off somewhere else entirely (e.g. still
    // on a different document's form).
    const freshList = !visitedDoctypes.has(dt);
    await maybeOpenHomeAndSearchList(dt);
    pendingDoctype = dt;
    if (freshList) await clickListAddButton(dt);
    else await newDoc(dt);
  },
  async searchAndCreateNew(dt) {
    // searchAndCreateNew() already drives its OWN real search internally —
    // only add the Home-first beat here (once, for the whole run's first
    // navigation), not a second redundant search before it.
    await maybeGoHomeFirst();
    visitedDoctypes.add(dt);
    pendingDoctype = dt;
    await searchAndCreateNew(dt);
  },
  async searchAndOpenDoctype(dt) {
    await maybeGoHomeFirst();
    visitedDoctypes.add(dt);
    await searchAndOpenDoctype(dt);
  },
  async gotoApp(p) { await gotoApp(p); },
  async setField(fields) {
    for (const [fn, val] of Object.entries(fields)) await setField(fn, val);
  },
  async setFrappeLinkField(input) {
    // {fieldname: "query"} or {fieldname: {query: "...", pick: 0}}
    for (const [fn, spec] of Object.entries(input)) {
      if (typeof spec === "string") await setFrappeLinkField(fn, spec);
      else await setFrappeLinkField(fn, spec.query, { pick: spec.pick ?? 0 });
    }
  },
  async toggleCheck(fn) {
    if (Array.isArray(fn)) { for (const f of fn) await toggleCheck(f); }
    else await toggleCheck(fn);
  },
  async clickTab(input) {
    if (typeof input === "string") await clickTab(input);
    else await clickTab(input.label, input.anchor);
  },
  async revealField(fn) { await revealField(fn); },
  async scrollToSel(input) {
    if (typeof input === "string") await scrollToSel(input);
    else await scrollToSel(input.sel, input.durMs);
  },
  async scrollToY(input) {
    if (typeof input === "number") await scrollToY(input);
    else await scrollToY(input.y, input.durMs);
  },
  async ensureGridRow(input) { await ensureGridRow(input.table, input.keyField); },
  async setGridField(input) {
    // {table, row?, fields:{fieldname:value}} — row defaults to the last row.
    for (const [fn, val] of Object.entries(input.fields)) {
      await setGridField(input.table, fn, val);
    }
  },
  async closeGridRow(table) { await closeGridRow(table); },
  async handleFrappeTableReorder(input) {
    await handleFrappeTableReorder(input.table, input.from, input.to);
  },
  async saveForm() { await saveForm(); await recordIfNewlyCreated(); },
  async submitForm() { await submitForm(); },
  async clickCustomButton(label) { await clickCustomButton(label); },
  async clickGroupItem(input) { await clickGroupItem(input.group, input.label); },
  async interceptFrappeModals(input) { await interceptFrappeModals(input || {}); },
  async clickListRow(index) { await clickListRow(index ?? 0); },
  async backToListView() { await backToListView(); },
  async clickDashboardLink(doctypeLabel) { await clickDashboardLink(doctypeLabel); },
  async switchListView(label) { await switchListView(label); },
  async toggleListFilter() { await toggleListFilter(); },
  async clearListFilters() { await clearListFilters(); },
  async openPrintView() {
    const newTab = await openPrintView();
    if (newTab) { extraTabs.push(newTab); await switchToTab(newTab); }
  },
  // Closing the "Full Page" tab leaves the MAIN page's app iframe still on
  // whatever route openPrintView()'s own print-icon click navigated it
  // to (frm.print_doc() does a same-tab SPA route change to the desk print
  // page BEFORE the new tab even opens) — not back on the document form.
  // A caller that then tries a form-only action (clickGroupItem, saveForm,
  // etc.) right after closeExtraTab was hitting "button group not found"
  // because of exactly this: the iframe was still showing the print page,
  // which obviously has no page-head custom buttons. Confirmed as a real
  // bug, not a hypothetical one, while recording a real flow. Navigate back
  // to openPrintView()'s remembered pre-navigation URL so the caller lands
  // on the actual form again, same as closing a real browser tab and
  // clicking back on the one still open behind it.
  async closeExtraTab() {
    const t = extraTabs.pop();
    if (t) { await t.close().catch(() => {}); await switchToTab(mainPage); }
    if (lastFormUrl) {
      await F().goto(lastFormUrl, { waitUntil: "domcontentloaded" });
      // `frappe.boot` existing only proves the Frappe APP FRAMEWORK loaded —
      // it's true almost immediately, long before `cur_frm` is bound and the
      // form's own DOM (`.form-layout`) has actually rendered. Waiting on
      // just `frappe.boot` (the old version here) let the NEXT step
      // (typically clickGroupItem/saveForm) measure a still-blank page and
      // fail with "button group not found" — a real, confirmed bug: the
      // captured frame right before that failure was genuinely blank white,
      // not a selector problem. Every other form-landing primitive
      // (newDoc/gotoApp's callers) waits on the real signal — `cur_frm`
      // bound AND `.form-layout` present — via waitForm(); do the same here
      // instead of a weaker ad hoc check.
      await F().waitForFunction(
        () => window.cur_frm && cur_frm.doc && document.querySelector(".form-layout"),
        null, { timeout: 25000 }
      ).catch(() => {});
      await hold(500);
      lastFormUrl = null;
    }
  },
  async maskSelectors(sels) { await maskSelectors(Array.isArray(sels) ? sels : [sels]); },
  async unmaskSelectors(sels) { await unmaskSelectors(Array.isArray(sels) ? sels : [sels]); },
  async caption(input) {
    if (typeof input === "string") await caption(input);
    else await caption(input.text, input.holdMs, input.fadeMs);
  },
  async captionPersist(text) { await captionPersist(text); },
  async clearCaption() { await clearCaption(); },
  async hold(ms) { await hold(ms); },
  async holdIdle(ms) { await holdIdle(ms); },
  async sleep(ms) { await sleep(ms); },
  async reloadDoc() { await reloadDoc(); },
  async runReport(input) { await runReport(input.name, input.filters || {}); },
  async scrollReportBody(input) {
    if (typeof input === "number") await scrollReportBody(input);
    else await scrollReportBody(input?.px, input?.durMs);
  },
  async asyncStep(input) {
    await asyncStep(input.group, input.label, input.script, input.bridgeText, ...(input.args || []));
  },
  async offCameraStep(input) {
    await offCameraStep(input.bridgeText, async () => bench(input.script, ...(input.args || [])));
  },
};

// A page/tab switch (e.g. openPrintView's "Full Page" button opening a new
// tab) must re-point BOTH `page` and `cdp` at the new tab and back — see
// SKILL.md's "Driving the app (CRITICAL)" section for why. mainPage/
// extraTabs track this generically so any step (not just one hardcoded flow)
// can open/close tabs.
let mainPage;
let extraTabs = [];
async function switchToTab(target) {
  page = target;
  cdp = await page.context().newCDPSession(page);
}

// Runs ONCE per flow, before the very first navigation of any kind — a real
// user opens the desk to its Home/workspace screen before doing anything
// else; they don't land cold on a doctype's list or /new route. Every LATER
// doctype switch in the same run starts from wherever the previous step left
// off, same as a real session.
async function maybeGoHomeFirst() {
  if (!isFirstNavigation) return;
  isFirstNavigation = false;
  await goHome();
}
// The realistic "how a person actually gets to a doctype" opening for
// newDoc() specifically (which otherwise jumps straight to a bare /new URL
// with no search at all): Home (first navigation only) → real navbar search
// → land on the doctype's LIST view → then newDoc()'s own direct nav takes
// over for the actual create. Only fires the first time a flow visits a
// given doctype — a flow creating several documents of the SAME doctype back
// to back doesn't repeat this before every single one, same as a real user
// not re-searching for something they're already looking at.
async function maybeOpenHomeAndSearchList(dt) {
  if (visitedDoctypes.has(dt)) return;
  visitedDoctypes.add(dt);
  await maybeGoHomeFirst();
  await searchAndOpenDoctype(dt);
}

async function runFlow(steps) {
  for (let i = 0; i < 50 && !F(); i++) await sleep(250);
  await sleep(400);
  for (const [idx, rawStep] of steps.entries()) {
    const step = resolveTemplate(rawStep);
    const [action, input] = Object.entries(step).find(([k]) => k !== "comment") || [];
    if (!action) continue;
    const handler = STEP_HANDLERS[action];
    if (!handler) {
      throw new Error(
        `runFlow: unknown step action "${action}" at step ${idx + 1}. ` +
        `Valid actions: ${Object.keys(STEP_HANDLERS).sort().join(", ")}`
      );
    }
    try {
      await handler(input);
    } catch (e) {
      e.message = `step ${idx + 1} ("${action}"): ${e.message}`;
      throw e;
    }
  }
}

// ======================================================= generic reset mode
// Deletes every document this run's createdDocs.json recorded, generically,
// for ANY doctype — no per-project reset-demo.py to hand-write. A submitted
// doc is cancelled first (delete_doc alone fails on docstatus=1). Runs
// server-side via bench python, same approach reset-demo.py always used,
// just generated from the tracked list instead of hardcoded doctype names.
function genericResetScript(docs) {
  const lines = [
    "import frappe",
    `frappe.init(site="${process.env.DEMO_SITE || new URL(BASE).hostname}")`,
    "frappe.connect()",
    "try:",
  ];
  // Reverse order: delete the LAST-created doc first — later docs in a flow
  // are usually the ones LINKING to earlier docs (e.g. an Opportunity links
  // back to a Lead), so deleting child-before-parent avoids link-exists
  // errors the other order would hit.
  for (const { doctype, name } of [...docs].reverse()) {
    const dt = doctype.replace(/"/g, '\\"');
    const nm = name.replace(/"/g, '\\"');
    lines.push(
      `    if frappe.db.exists("${dt}", "${nm}"):`,
      `        doc = frappe.get_doc("${dt}", "${nm}")`,
      `        if doc.docstatus == 1:`,
      `            try: doc.cancel()`,
      `            except Exception: frappe.db.set_value("${dt}", "${nm}", "docstatus", 0); frappe.db.commit()`,
      `        frappe.delete_doc("${dt}", "${nm}", force=1, ignore_permissions=True, delete_permanently=True)`,
      `        frappe.db.commit()`,
      `        print("  deleted ${dt} ${nm}")`,
    );
  }
  lines.push("finally:", "    frappe.destroy()");
  return lines.join("\n");
}
function runGenericReset(docs) {
  if (docs.length === 0) return;
  const tmpScript = path.join(OUT_DIR, "_generic-reset.py");
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(tmpScript, genericResetScript(docs));
  try {
    const out = execFileSync(path.join(BENCH, "env", "bin", "python"), [tmpScript],
      { cwd: path.join(BENCH, "sites"), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    console.log(out);
  } finally {
    fs.rmSync(tmpScript, { force: true });
  }
}

const CREATED_DOCS_FILE = path.join(OUT_DIR, "created-docs.json");

if (RESET_ONLY) {
  const docs = fs.existsSync(CREATED_DOCS_FILE) ? JSON.parse(fs.readFileSync(CREATED_DOCS_FILE, "utf8")) : [];
  console.log(`▶ Resetting ${docs.length} doc(s) tracked from the last run...`);
  runGenericReset(docs);
  console.log("✓ Reset done");
  process.exit(0);
}

const steps = JSON.parse(fs.readFileSync(STEPS_FILE, "utf8"));

// ======================================================================= boot
const browser = await chromium.launch({
  // Full Chromium, not Playwright's headless shell: the shell has no PDF viewer and
  // downloads PDFs instead of rendering them (matters if the flow opens an attachment).
  channel: "chromium",
  headless: true,
  args: [
    "--disable-web-security",
    "--disable-features=LocalNetworkAccessChecks,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessChecks,IsolateOrigins,site-per-process",
  ],
});
// Authenticate off-camera via the login API so the recording never shows login.
const reqCtx = await request.newContext();
const lr = await reqCtx.post(BASE + "/api/method/login", { form: { usr: USER, pwd: PASS } });
if (!lr.ok()) throw new Error("API login failed: " + lr.status());
const storageState = await reqCtx.storageState();
await reqCtx.dispose();

const context = await browser.newContext({
  viewport: VIEW,
  deviceScaleFactor: 1, // capture retina via clip.scale instead (DSF is ignored by captureScreenshot)
  storageState,
});
await context.addInitScript(INIT);
page = await context.newPage();
mainPage = page;
page.setDefaultTimeout(20000);
await page.route("**/__ip_stage", (r) => r.fulfill({ contentType: "text/html", body: STAGE }));
await page.goto(BASE + "/__ip_stage", { waitUntil: "domcontentloaded" });
cdp = await context.newCDPSession(page);

fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(FRAME_DIR, { recursive: true });

let ok = true;
try {
  await runFlow(steps);
  // Flush every queued async frame write BEFORE reporting success — cap()/dup()
  // no longer block on disk per-frame (see queueWrite), so without this a
  // render could report "done" and exit while some tail frames are still being
  // written, racing make-video.sh's own frame-count check.
  await flushFrameWrites();
  console.log(`\n✓ Rendered ${FRAME} frames @ ${FPS}fps (~${(FRAME / FPS).toFixed(1)}s)`);
} catch (e) {
  ok = false;
  await flushFrameWrites().catch(() => {});
  console.error("\n✗ Flow failed:", e.message);
} finally {
  // Write the created-docs list even on failure — a partially-run flow can
  // still have created real documents that need cleaning up before the next
  // take, and `--reset-only` is how that happens generically.
  fs.writeFileSync(CREATED_DOCS_FILE, JSON.stringify(createdDocs, null, 2));
  for (const t of extraTabs) await t.close().catch(() => {});
  await page.close();
  await context.close();
  await browser.close();
  console.log("FRAMES:" + FRAME_DIR + " COUNT:" + FRAME);
  console.log("CREATED_DOCS:" + CREATED_DOCS_FILE);
  process.exit(ok ? 0 : 1);
}
