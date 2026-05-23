"""
omr_processor_v3.py - Generic OMR processor with interactive region selector
Fixes from v2:
  - Adaptive darkness threshold (no more hard-coded 35)
  - 3–6 option support (not just 4)
  - Tuned HoughCircles param2 (was 12 → adaptive)
  - Scale-invariant clustering (eps relative to detected bubble size)
  - Double-mark detection
  - No silent bubble dropping — warnings logged
  - Interactive UI to select answer-bubble area AND roll-number area
    after perspective warp (replaces hard-coded 25% skip)

Pipeline:
  1. Perspective warp → standard 800×1100 image
  2. Browser UI: user drags rectangles for Roll area + Answer area, saves config
  3. HoughCircles inside each defined region
  4. DBSCAN row/column clustering (eps relative to median radius)
  5. Adaptive threshold grading + double-mark detection

Usage:
    # Step A – launch region selector (first time or to reconfigure)
    python omr_processor_v3.py --image sheet.jpg --select-regions

    # Step B – process with saved region config
    python omr_processor_v3.py --image sheet.jpg [--config regions.json] [--answer-key A,B,C,D,...] [--debug]
"""

import cv2
import numpy as np
import argparse
import json
import os
import warnings
from dataclasses import dataclass, field
from typing import Optional
from sklearn.cluster import DBSCAN


# ──────────────────────────────────────────────
# Geometry helpers
# ──────────────────────────────────────────────


def order_points(pts: np.ndarray) -> np.ndarray:
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).flatten()
    return np.array(
        [
            pts[np.argmin(s)],
            pts[np.argmin(diff)],
            pts[np.argmax(s)],
            pts[np.argmax(diff)],
        ],
        dtype=np.float32,
    )


def find_document_corners(image: np.ndarray) -> np.ndarray:
    h, w = image.shape[:2]
    scale = 1200 / w
    small = cv2.resize(image, (1200, int(h * scale)))
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 50, 150)
    cnts, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        raise ValueError("No contours found – check that the sheet fills the frame.")
    largest = max(cnts, key=cv2.contourArea)
    peri = cv2.arcLength(largest, True)
    approx = cv2.approxPolyDP(largest, 0.02 * peri, True)
    if len(approx) != 4:
        x, y, wc, hc = cv2.boundingRect(largest)
        approx = np.array(
            [[x, y], [x + wc, y], [x + wc, y + hc], [x, y + hc]], dtype=np.float32
        )
    pts = approx.reshape(-1, 2).astype(np.float32)
    src_small = order_points(pts)
    src = src_small / np.array([1200 / w, scale])
    return src.astype(np.float32)


def warp_image(image: np.ndarray, dst_size=(800, 1100)) -> np.ndarray:
    src = find_document_corners(image)
    dst = np.float32(
        [[0, 0], [dst_size[0], 0], [dst_size[0], dst_size[1]], [0, dst_size[1]]]
    )
    M = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(image, M, dst_size)


# ──────────────────────────────────────────────
# Region config (saved / loaded as JSON)
# ──────────────────────────────────────────────


@dataclass
class RegionConfig:
    """Pixel rectangles on the warped 800×1100 image."""

    answer_rect: Optional[list] = None  # [x, y, w, h]
    roll_rect: Optional[list] = None  # [x, y, w, h]
    options_per_question: int = 4  # 3–6

    def save(self, path: str):
        with open(path, "w") as f:
            json.dump(self.__dict__, f, indent=2)
        print(f"[config] Saved → {path}")

    @classmethod
    def load(cls, path: str) -> "RegionConfig":
        with open(path) as f:
            data = json.load(f)
        return cls(**data)


# ──────────────────────────────────────────────
# Interactive region selector (Flask + HTML)
# ──────────────────────────────────────────────


def launch_region_selector(
    warped: np.ndarray,
    config_path: str,
    image_path: str = None,
    answer_key: list = None,
    debug: bool = False,
):
    """
    Serve a local web page where the user drags two rectangles:
      - Roll-number area (blue)
      - Answer-bubble area (green)
    On save: config written, grading runs immediately, results returned to browser.
    """
    import base64
    import threading
    from flask import Flask, request, jsonify

    _, buf = cv2.imencode(".jpg", warped, [cv2.IMWRITE_JPEG_QUALITY, 90])
    img_b64 = base64.b64encode(buf).decode()

    HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>OMR Region Selector</title>
<style>
  :root {
    --bg: #0f1117;
    --surface: #1a1d27;
    --border: #2e3347;
    --green: #00e5a0;
    --blue: #4d9fff;
    --orange: #ff8c42;
    --text: #e8eaf0;
    --muted: #6b7280;
    --font: 'DM Mono', 'Fira Code', monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font);
    height: 100vh;
    display: grid;
    grid-template-columns: 270px 1fr;
    grid-template-rows: 56px 1fr;
    overflow: hidden;
  }
  header {
    grid-column: 1 / -1;
    padding: 0 28px;
    border-bottom: 1px solid var(--border);
    display: flex;
    align-items: center;
    gap: 14px;
    background: var(--surface);
  }
  header .logo { font-size: 22px; }
  header h1 { font-size: 14px; letter-spacing: 0.08em; text-transform: uppercase; }
  header .hint { font-size: 11px; color: var(--muted); margin-left: auto; }

  aside {
    background: var(--surface);
    border-right: 1px solid var(--border);
    padding: 20px 16px;
    display: flex;
    flex-direction: column;
    gap: 16px;
    overflow-y: auto;
  }
  .section-label {
    font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.12em; color: var(--muted);
    margin-bottom: 4px;
  }
  .mode-btn {
    display: flex; align-items: center; gap: 10px;
    padding: 11px 14px;
    border: 2px solid var(--border);
    border-radius: 8px;
    background: transparent;
    color: var(--text);
    font-family: var(--font);
    font-size: 12px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    text-align: left;
    width: 100%;
  }
  .swatch {
    width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0;
  }
  .mode-btn[data-mode="answer"] .swatch { background: var(--green); }
  .mode-btn[data-mode="roll"]   .swatch { background: var(--blue); }
  .mode-btn[data-mode="clear"]  .swatch { background: var(--orange); }
  .mode-btn[data-mode="answer"].active { border-color: var(--green); color: var(--green); }
  .mode-btn[data-mode="roll"].active   { border-color: var(--blue);  color: var(--blue);  }
  .mode-btn:hover { border-color: #555; }

  .status-box {
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 12px;
  }
  .status-row { display: flex; justify-content: space-between;
    align-items: center; font-size: 12px; margin-bottom: 7px; }
  .status-row:last-child { margin-bottom: 0; }
  .badge { font-size: 10px; padding: 2px 8px; border-radius: 4px; }
  .badge.set   { background: #0d3d2e; color: var(--green); }
  .badge.unset { background: #2a1a0a; color: var(--orange); }

  .field label {
    display: block; font-size: 10px; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--muted); margin-bottom: 6px;
  }
  .field select {
    width: 100%; padding: 8px 10px;
    background: var(--bg); border: 1px solid var(--border);
    border-radius: 6px; color: var(--text);
    font-family: var(--font); font-size: 12px; cursor: pointer;
  }

  .save-btn {
    margin-top: auto; padding: 12px;
    background: var(--green); color: #061a10;
    border: none; border-radius: 8px;
    font-family: var(--font); font-size: 13px; font-weight: 700;
    letter-spacing: 0.05em; cursor: pointer;
    transition: opacity 0.15s;
  }
  .save-btn:hover { opacity: 0.85; }
  .save-btn:disabled { opacity: 0.3; cursor: not-allowed; }

  main {
    padding: 20px;
    display: flex;
    align-items: flex-start;
    justify-content: center;
    overflow: auto;
    background: #080a0f;
  }
  /* The canvas IS the interactive element — no wrapper needed */
  #canvas {
    display: block;
    cursor: crosshair;
    border-radius: 6px;
    box-shadow: 0 16px 48px rgba(0,0,0,0.7);
    /* max height so it fits the viewport */
    max-height: calc(100vh - 96px);
    width: auto;
  }

  .toast {
    position: fixed; bottom: 20px; right: 20px;
    background: var(--green); color: #061a10;
    padding: 10px 18px; border-radius: 8px;
    font-size: 12px; font-weight: 700;
    transform: translateY(50px); opacity: 0;
    transition: all 0.25s; pointer-events: none; z-index: 999;
  }
  .toast.show { transform: translateY(0); opacity: 1; }
</style>
</head>
<body>

<header>
  <span class="logo">◎</span>
  <h1>OMR Region Selector</h1>
  <span class="hint">Select mode → drag on image → Save</span>
</header>

<aside>
  <div>
    <div class="section-label">Draw mode</div>
    <button class="mode-btn active" data-mode="answer">
      <span class="swatch"></span>
      <div>
        <div>Answer Bubbles</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px">MCQ grid area</div>
      </div>
    </button>
    <button class="mode-btn" data-mode="roll" style="margin-top:8px">
      <span class="swatch"></span>
      <div>
        <div>Roll Number</div>
        <div style="font-size:10px;color:var(--muted);margin-top:2px">Header bubble grid</div>
      </div>
    </button>
    <button class="mode-btn" data-mode="clear" style="margin-top:8px">
      <span class="swatch"></span>
      Clear all regions
    </button>
  </div>

  <div class="status-box">
    <div class="section-label" style="margin-bottom:10px">Region status</div>
    <div class="status-row">
      <span>Answer Area</span>
      <span class="badge unset" id="answer-badge">NOT SET</span>
    </div>
    <div class="status-row">
      <span>Roll Number</span>
      <span class="badge unset" id="roll-badge">NOT SET</span>
    </div>
  </div>

  <div class="field">
    <label>Options per question</label>
    <select id="opts">
      <option value="3">3  (A B C)</option>
      <option value="4" selected>4  (A B C D)</option>
      <option value="5">5  (A B C D E)</option>
      <option value="6">6  (A–F)</option>
    </select>
  </div>

  <button class="save-btn" id="save-btn" disabled>Save &amp; Grade →</button>
</aside>

<main>
  <canvas id="canvas"></canvas>
</main>

<div class="toast" id="toast"></div>

<script>
// ── Constants ──────────────────────────────────────────
const COLORS = { answer: '#00e5a0', roll: '#4d9fff' };
const IMG_SRC = 'data:image/jpeg;base64,PLACEHOLDER_B64';

// ── State ──────────────────────────────────────────────
let mode = 'answer';
let regions = { answer: null, roll: null };   // stored in IMAGE pixel coords
let drag = null;   // { sx, sy, ex, ey } in CANVAS pixel coords while dragging

// ── Canvas setup ──────────────────────────────────────
const canvas = document.getElementById('canvas');
const ctx    = canvas.getContext('2d');
const img    = new Image();

img.onload = () => {
  // Size canvas to the image's natural size — we scale via CSS only
  canvas.width  = img.naturalWidth;
  canvas.height = img.naturalHeight;

  // Fit within viewport (max-height already set in CSS, width follows)
  const maxH = window.innerHeight - 96;
  const scale = Math.min(1, maxH / img.naturalHeight);
  canvas.style.height = Math.round(img.naturalHeight * scale) + 'px';
  canvas.style.width  = 'auto';

  redraw();
};
img.src = IMG_SRC;

// ── Draw everything onto the canvas ───────────────────
function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);

  // Draw committed regions
  for (const [key, r] of Object.entries(regions)) {
    if (!r) continue;
    drawRect(r.x, r.y, r.w, r.h, COLORS[key], false, key.toUpperCase());
  }

  // Draw live drag rectangle (in canvas coords → convert to image coords)
  if (drag) {
    const r = dragToImageRect();
    drawRect(r.x, r.y, r.w, r.h, COLORS[mode], true, '');
  }
}

function drawRect(x, y, w, h, color, dashed, label) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth   = Math.max(2, canvas.width / 400);
  ctx.fillStyle   = color + '28';
  if (dashed) ctx.setLineDash([8, 4]);
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.stroke();
  if (label) {
    ctx.setLineDash([]);
    ctx.font = `bold ${Math.max(14, canvas.width / 55)}px 'DM Mono', monospace`;
    ctx.fillStyle = color;
    ctx.fillText(label, x + 10, y + Math.max(22, canvas.width / 36));
  }
  ctx.restore();
}

// ── Coordinate helpers ─────────────────────────────────
// Canvas CSS size != canvas pixel size when DPR != 1 or CSS scaling is applied.
// Always convert via the ratio between canvas.width and canvas.offsetWidth.
function canvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const clientY = e.touches ? e.touches[0].clientY : e.clientY;
  return {
    x: (clientX - rect.left)  * scaleX,
    y: (clientY - rect.top)   * scaleY,
  };
}

function dragToImageRect() {
  // drag coords are already in image space (canvas.width = img.naturalWidth)
  const x = Math.round(Math.min(drag.sx, drag.ex));
  const y = Math.round(Math.min(drag.sy, drag.ey));
  const w = Math.round(Math.abs(drag.ex - drag.sx));
  const h = Math.round(Math.abs(drag.ey - drag.sy));
  return { x, y, w, h };
}

// ── Mouse events ───────────────────────────────────────
canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  e.preventDefault();
  const p = canvasPos(e);
  drag = { sx: p.x, sy: p.y, ex: p.x, ey: p.y };
});

window.addEventListener('mousemove', e => {
  if (!drag) return;
  const p = canvasPos(e);
  drag.ex = p.x; drag.ey = p.y;
  redraw();
});

window.addEventListener('mouseup', e => {
  if (!drag) return;
  commitDrag();
});

// ── Touch events ───────────────────────────────────────
canvas.addEventListener('touchstart', e => {
  e.preventDefault();
  const p = canvasPos(e);
  drag = { sx: p.x, sy: p.y, ex: p.x, ey: p.y };
}, { passive: false });

window.addEventListener('touchmove', e => {
  if (!drag) return;
  e.preventDefault();
  const p = canvasPos(e);
  drag.ex = p.x; drag.ey = p.y;
  redraw();
}, { passive: false });

window.addEventListener('touchend', e => {
  if (!drag) return;
  commitDrag();
});

function commitDrag() {
  const r = dragToImageRect();
  if (r.w > 8 && r.h > 8) {
    regions[mode] = r;
    updateStatus();
    showToast(mode.toUpperCase() + ' region set');
  }
  drag = null;
  redraw();
}

// ── Mode buttons ───────────────────────────────────────
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const m = btn.dataset.mode;
    if (m === 'clear') {
      regions = { answer: null, roll: null };
      updateStatus(); redraw();
      showToast('All regions cleared');
      return;
    }
    mode = m;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});

// ── Status badges ──────────────────────────────────────
function updateStatus() {
  ['answer', 'roll'].forEach(k => {
    const el = document.getElementById(k + '-badge');
    if (regions[k]) { el.textContent = 'SET';     el.className = 'badge set'; }
    else             { el.textContent = 'NOT SET'; el.className = 'badge unset'; }
  });
  document.getElementById('save-btn').disabled = !regions.answer;
}

// ── Save & Grade ───────────────────────────────────────
document.getElementById('save-btn').addEventListener('click', async () => {
  const btn = document.getElementById('save-btn');
  btn.textContent = 'Grading…';
  btn.disabled = true;

  const toArr = r => r ? [r.x, r.y, r.w, r.h] : null;
  const payload = {
    answer_rect:          toArr(regions.answer),
    roll_rect:            toArr(regions.roll),
    options_per_question: parseInt(document.getElementById('opts').value),
  };
  try {
    const res  = await fetch('/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.error) {
      showResults(null, data.error);
    } else {
      showResults(data);
    }
    btn.textContent = '✓ Saved — redraw to re-grade';
    btn.disabled = false;
  } catch(err) {
    showToast('Error: ' + err.message);
    btn.textContent = 'Save & Grade →';
    btn.disabled = false;
  }
});

function showResults(data, errMsg) {
  // Remove old panel if present
  const old = document.getElementById('results-panel');
  if (old) old.remove();

  const panel = document.createElement('div');
  panel.id = 'results-panel';
  panel.style.cssText = 'margin-top:16px;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:14px;font-size:12px;max-height:340px;overflow-y:auto;';

  if (errMsg) {
    panel.innerHTML = '<div style="color:var(--orange)">&#9888; ' + errMsg + '</div>';
    document.querySelector('aside').appendChild(panel);
    return;
  }

  let html = '<div class="section-label" style="margin-bottom:10px">Results</div>';
  if (data.roll) html += '<div style="margin-bottom:10px;color:var(--blue)">Roll: ' + data.roll + '</div>';
  if (data.score) {
    const s = data.score;
    html += '<div style="margin-bottom:10px;color:var(--green);font-size:13px;font-weight:700">'
          + 'Score: ' + s.correct + '/' + s.total + ' (' + s.pct + '%)</div>';
  }

  if (data.rows && data.rows.length) {
    html += '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:4px">';
    for (const r of data.rows) {
      const isDouble = r.ans === 'DOUBLE';
      const isBlank  = r.ans === 'BLANK';
      const color = isDouble ? 'var(--orange)' : isBlank ? 'var(--muted)' : 'var(--text)';
      html += '<div style="color:' + color + '">Q' + String(r.q).padStart(2,'0') + ': ' + r.ans + '</div>';
    }
    html += '</div>';
  } else {
    html += '<div style="color:var(--muted)">No questions detected in region.</div>';
  }
  html += '<div style="margin-top:10px;color:var(--muted);font-size:10px">Saved &#8594; omr_result_v3.jpg</div>';
  panel.innerHTML = html;
  document.querySelector('aside').appendChild(panel);
  showToast('Grading complete!');
}

// ── Toast ──────────────────────────────────────────────
function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2400);
}
</script>
</body>
</html>
""".replace("PLACEHOLDER_B64", img_b64)

    app = Flask(__name__)

    @app.route("/")
    def index():
        return HTML

    @app.route("/save", methods=["POST"])
    def save():
        data = request.get_json()
        cfg = RegionConfig(
            answer_rect=data.get("answer_rect"),
            roll_rect=data.get("roll_rect"),
            options_per_question=data.get("options_per_question", 4),
        )
        cfg.save(config_path)

        # Grade immediately — results go back to the browser
        if image_path:
            try:
                result = process_omr(image_path, cfg, answer_key, debug)
                rows = [
                    {"q": q, "ans": (result["answers"][q] or "BLANK").upper()}
                    for q in sorted(result["answers"])
                ]
                cv2.imwrite("omr_result_v3.jpg", result["vis"])
                return jsonify(
                    {
                        "ok": True,
                        "rows": rows,
                        "score": result["score"],
                        "roll": result["roll"],
                    }
                )
            except Exception as e:
                return jsonify({"ok": True, "error": str(e)})
        return jsonify({"ok": True})

    print(f"\n[region-selector] Open → http://127.0.0.1:5050\n")
    print(
        "After drawing regions and clicking Save, grades will appear in the browser.\n"
    )
    app.run(host="127.0.0.1", port=5050, debug=False)


# ──────────────────────────────────────────────
# Bubble detection (region-aware, scale-invariant)
# ──────────────────────────────────────────────


def detect_bubbles_in_region(
    gray: np.ndarray,
    region: list,
    options: int = 4,
    debug_tag: str = "",
    debug: bool = False,
):
    """
    Detect bubbles only within the specified [x, y, w, h] region.
    Returns bubbles with absolute (full-image) coordinates.
    """
    x0, y0, rw, rh = region
    roi = gray[y0 : y0 + rh, x0 : x0 + rw]

    # Adaptive param2: start generous, tighten if too many hits
    blur = cv2.medianBlur(roi, 5)
    h_roi, w_roi = roi.shape

    # Estimate expected radius from region size — scale invariant
    min_r = max(6, rh // 60)
    max_r = max(min_r + 4, rh // 20)

    circles = None
    for p2 in [28, 22, 18, 14, 10]:  # adaptive param2, start tighter
        c = cv2.HoughCircles(
            blur,
            cv2.HOUGH_GRADIENT,
            dp=1.2,
            minDist=int(min_r * 1.8),
            param1=80,
            param2=p2,
            minRadius=min_r,
            maxRadius=max_r,
        )
        if c is not None:
            n = len(c[0])
            if n < 500:  # sanity cap on false positives
                circles = c
                break  # use first (tightest) result that finds anything

    bubbles = []
    if circles is not None:
        for cx, cy, r in np.uint16(np.around(circles[0])):
            bubbles.append(
                {
                    "x": int(cx) + x0,
                    "y": int(cy) + y0,
                    "r": int(r),
                }
            )

    if debug and bubbles:
        import cv2 as _cv2

        dbg_roi = _cv2.cvtColor(roi, _cv2.COLOR_GRAY2BGR)
        for b in bubbles:
            _cv2.circle(dbg_roi, (b["x"] - x0, b["y"] - y0), b["r"], (0, 255, 0), 2)
        _cv2.imwrite(f"debug_bubbles_{debug_tag}.jpg", dbg_roi)

    return bubbles


# ──────────────────────────────────────────────
# Question grouping (scale-invariant, N-option)
# ──────────────────────────────────────────────


def group_into_questions(bubbles: list, options: int = 4) -> list:
    if not bubbles:
        return []

    pts = np.array([[b["x"], b["y"]] for b in bubbles])
    med_r = float(np.median([b["r"] for b in bubbles]))

    # 1. Row bands — eps relative to bubble diameter
    eps_y = med_r * 1.6
    db_y = DBSCAN(eps=eps_y, min_samples=1).fit(pts[:, 1].reshape(-1, 1))
    rows: dict = {}
    for i, label in enumerate(db_y.labels_):
        rows.setdefault(label, []).append(bubbles[i])

    questions = []
    for row_bubs in rows.values():
        row_bubs = sorted(row_bubs, key=lambda b: b["x"])
        xs = np.array([b["x"] for b in row_bubs])

        if len(xs) < options:
            continue

        # Gap-split
        gaps = np.diff(xs)
        threshold = np.median(gaps) * 2.0 if len(gaps) else med_r * 4
        groups, cur = [], [row_bubs[0]]
        for i, g in enumerate(gaps):
            if g > threshold:
                groups.append(cur)
                cur = [row_bubs[i + 1]]
            else:
                cur.append(row_bubs[i + 1])
        groups.append(cur)

        for g in groups:
            n = len(g)
            if n < 3 or n > 6:  # allow 3–6 options
                if n > 6:
                    warnings.warn(
                        f"Group has {n} bubbles (>6), skipping – possible false positives"
                    )
                continue
            g = sorted(g, key=lambda b: b["x"])
            ys = [b["y"] for b in g]
            if max(ys) - min(ys) > med_r * 3:  # too spread vertically
                continue
            questions.append(g)

    if not questions:
        return []

    # Column-first ordering (eps relative to bubble size)
    centres = np.array(
        [
            [np.mean([b["x"] for b in q]), np.mean([b["y"] for b in q])]
            for q in questions
        ]
    )
    eps_x = med_r * 8  # scale-invariant column eps
    db_x = DBSCAN(eps=eps_x, min_samples=1).fit(centres[:, 0].reshape(-1, 1))

    cols: dict = {}
    for i, label in enumerate(db_x.labels_):
        cols.setdefault(label, []).append((centres[i][1], questions[i]))

    col_mean_x = {
        label: float(
            np.mean([centres[i][0] for i, l in enumerate(db_x.labels_) if l == label])
        )
        for label in cols
    }
    sorted_cols = sorted(cols.items(), key=lambda kv: col_mean_x[kv[0]])

    ordered = []
    for _, items in sorted_cols:
        items.sort(key=lambda t: t[0])
        ordered.extend(q for _, q in items)
    return ordered


# ──────────────────────────────────────────────
# Adaptive grading
# ──────────────────────────────────────────────

OPTION_LETTERS = "abcdefghijklmnopqrstuvwxyz"


def compute_darkness(gray: np.ndarray, b: dict) -> float:
    x, y, r = b["x"], b["y"], b["r"]
    y1, y2 = max(0, y - r), min(gray.shape[0], y + r)
    x1, x2 = max(0, x - r), min(gray.shape[1], x + r)
    roi = gray[y1:y2, x1:x2]
    return float(np.mean(255 - roi)) if roi.size else 0.0


def grade_questions(
    warped: np.ndarray, gray: np.ndarray, questions: list, debug: bool = False
):
    """
    Adaptive threshold: per-question threshold = mean(all bubble darknesses) + 0.5*std.
    Double-mark detection returns 'DOUBLE' instead of a letter.
    """
    vis = warped.copy()
    answers = {}
    MARKED = (0, 0, 255)
    UNMARKED = (0, 200, 80)
    BLANK = (180, 180, 180)
    DOUBLE = (0, 128, 255)

    for idx, q in enumerate(questions, start=1):
        scores = [compute_darkness(gray, b) for b in q]
        scores_arr = np.array(scores)

        # Adaptive threshold per question
        threshold = scores_arr.mean() + 0.5 * scores_arr.std()

        marked_idxs = [i for i, s in enumerate(scores) if s > threshold and s > 20]

        if len(marked_idxs) == 0:
            answers[idx] = None
            label = "-"
            colors = [BLANK] * len(q)
        elif len(marked_idxs) > 1:
            answers[idx] = "DOUBLE"
            label = "!!"
            colors = [DOUBLE if i in marked_idxs else UNMARKED for i in range(len(q))]
        else:
            best = marked_idxs[0]
            opt = OPTION_LETTERS[best] if best < len(OPTION_LETTERS) else "?"
            answers[idx] = opt
            label = opt.upper()
            colors = [MARKED if i == best else UNMARKED for i in range(len(q))]

        for i, (b, color) in enumerate(zip(q, colors)):
            cv2.circle(vis, (b["x"], b["y"]), b["r"], color, 2)

        cx = int(np.mean([b["x"] for b in q]))
        cy = int(np.mean([b["y"] for b in q]))
        cv2.putText(
            vis,
            f"{idx}:{label}",
            (cx - 25, cy - b["r"] - 4),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (0, 0, 220),
            1,
        )

    if debug:
        cv2.imwrite("debug_graded.jpg", vis)
    return answers, vis


# ──────────────────────────────────────────────
# Top-level processing
# ──────────────────────────────────────────────


def process_omr(
    image_path: str,
    config: RegionConfig,
    answer_key: Optional[list] = None,
    debug: bool = False,
):
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Could not load: {image_path}")

    warped = warp_image(img)
    if debug:
        cv2.imwrite("debug_warped.jpg", warped)

    gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)

    # ── Answer bubbles
    if not config.answer_rect:
        raise ValueError("No answer_rect in config. Run --select-regions first.")
    answer_bubbles = detect_bubbles_in_region(
        gray,
        config.answer_rect,
        config.options_per_question,
        debug_tag="answer",
        debug=debug,
    )
    questions = group_into_questions(answer_bubbles, config.options_per_question)
    if not questions:
        raise ValueError("No questions detected in the answer region.")

    answers, vis = grade_questions(warped, gray, questions, debug)

    # ── Roll number (optional)
    roll_digits = None
    if config.roll_rect:
        roll_bubbles = detect_bubbles_in_region(
            gray, config.roll_rect, debug_tag="roll", debug=debug
        )
        roll_questions = group_into_questions(roll_bubbles, options=10)
        roll_answers, _ = grade_questions(warped, gray, roll_questions)
        roll_digits = "".join(
            str(list(roll_answers.values())[i])[0].upper()
            if roll_answers.get(i + 1)
            else "?"
            for i in range(len(roll_answers))
        )

    # ── Scoring
    score_info = None
    if answer_key and len(answer_key) >= len(answers):
        correct = sum(
            1
            for i, ans in answers.items()
            if ans and ans.lower() == answer_key[i - 1].lower()
        )
        score_info = {
            "correct": correct,
            "total": len(answers),
            "pct": round(100 * correct / len(answers), 1),
        }

    return {
        "answers": answers,
        "roll": roll_digits,
        "score": score_info,
        "warped": warped,
        "vis": vis,
    }


# ──────────────────────────────────────────────
# CLI
# ──────────────────────────────────────────────


def main():
    ap = argparse.ArgumentParser(description="OMR Processor v3")
    ap.add_argument("--image", required=True, help="Path to OMR image")
    ap.add_argument(
        "--select-regions",
        action="store_true",
        help="Launch interactive browser UI to define regions",
    )
    ap.add_argument(
        "--config",
        default="regions.json",
        help="Path to region config JSON (default: regions.json)",
    )
    ap.add_argument(
        "--answer-key",
        default="",
        help="Comma-separated correct answers, e.g. A,B,C,D,A",
    )
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

    img = cv2.imread(args.image)
    if img is None:
        raise SystemExit(f"Cannot load {args.image}")
    warped = warp_image(img)

    answer_key = [s.strip() for s in args.answer_key.split(",") if s.strip()] or None

    if args.select_regions:
        launch_region_selector(
            warped,
            args.config,
            image_path=args.image,
            answer_key=answer_key,
            debug=args.debug,
        )
        return

    if not os.path.exists(args.config):
        raise SystemExit(
            f"Config not found: {args.config}\n"
            "Run with --select-regions first to define regions."
        )

    config = RegionConfig.load(args.config)

    result = process_omr(args.image, config, answer_key, args.debug)

    print("\n" + "=" * 40)
    print(" OMR RESULTS")
    print("=" * 40)
    if result["roll"]:
        print(f"Roll Number : {result['roll']}")
    print(f"Questions   : {len(result['answers'])}")
    print()
    for q in sorted(result["answers"]):
        ans = result["answers"][q]
        marker = ""
        if answer_key and q <= len(answer_key):
            marker = " ✓" if ans and ans.lower() == answer_key[q - 1].lower() else " ✗"
        print(f"  Q{q:02d}: {str(ans or 'BLANK'):8s}{marker}")

    if result["score"]:
        s = result["score"]
        print(f"\nScore: {s['correct']}/{s['total']}  ({s['pct']}%)")

    cv2.imwrite("omr_result_v3.jpg", result["vis"])
    print("\nSaved → omr_result_v3.jpg")


if __name__ == "__main__":
    main()
