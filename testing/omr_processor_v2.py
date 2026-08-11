"""
omr_processor_v2.py - Generic OMR processor
Supports variable number of questions, columns and options.

Pipeline:
1. Perspective warp via outer border
2. Otsu's thresholding & Contour detection for robust bubble isolation
3. Filter by shape (aspect ratio) and size
4. DBSCAN on Y to get row bands
5. Split each band into question groups by X gaps & DBSCAN for columns
6. Grade by exact pixel counting
"""

import cv2
import numpy as np
import argparse
from sklearn.cluster import DBSCAN


def order_points(pts):
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).flatten()
    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmin(diff)]
    bl = pts[np.argmax(diff)]
    return np.array([tl, tr, br, bl], dtype=np.float32)


def find_document_corners(image):
    h, w = image.shape[:2]
    small = cv2.resize(image, (1200, int(1200 * h / w)))
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 50, 150)
    cnts = cv2.findContours(
        image=edges, mode=cv2.RETR_EXTERNAL, method=cv2.CHAIN_APPROX_SIMPLE
    )
    cnts = cnts[0] if len(cnts) == 2 else cnts[1]
    if not cnts:
        raise ValueError("No contours found")
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
    scale_x = w / 1200
    scale_y = h / small.shape[0]
    src = src_small * np.array([scale_x, scale_y])
    return src.astype(np.float32)


def warp_image(image, dst_size=(800, 1100)):
    src = find_document_corners(image)
    dst = np.float32(
        [[0, 0], [dst_size[0], 0], [dst_size[0], dst_size[1]], [0, dst_size[1]]]
    )
    M = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(image, M, dst_size)


def detect_all_bubbles(warped, debug=False):
    gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)

    # 1. Binarize the image (black bubbles become white on black background)
    # --- THE FIX: Adaptive Thresholding ---
    # Apply a slight blur to reduce paper grain/noise before binarizing
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)

    # Adaptive threshold calculates the black/white cut-off locally
    # This perfectly handles lighting gradients and shadows across the page
    thresh = cv2.adaptiveThreshold(
        blurred,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        blockSize=51,
        C=10,
    )

    # 2. Find contours
    cnts = cv2.findContours(thresh.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cnts = cnts[0] if len(cnts) == 2 else cnts[1]

    bubbles = []
    h, w = gray.shape
    y0 = int(h * 0.25)  # Focus on lower 75% to skip header

    for c in cnts:
        x, y, bw, bh = cv2.boundingRect(c)
        ar = bw / float(bh)

        # 3. Filter for roughly circular shapes
        if 12 <= bw <= 35 and 12 <= bh <= 35 and 0.8 <= ar <= 1.2:
            cx = int(x + (bw / 2))
            cy = int(y + (bh / 2))

            # Keep only plausible question area
            if cy < h * 0.3 or cy > h * 0.95:
                continue

            bubbles.append({"x": cx, "y": cy, "r": int(bw / 2)})

    if debug:
        dbg = warped.copy()
        for b in bubbles:
            cv2.circle(dbg, (b["x"], b["y"]), b["r"], (0, 255, 0), 2)
        cv2.imwrite("debug_all_bubbles_robust.jpg", dbg)

    return bubbles, thresh


def group_into_questions(bubbles):
    if not bubbles:
        return []
    pts = np.array([[b["x"], b["y"]] for b in bubbles])

    # 1) Row bands by Y
    med_h = np.median([b["r"] * 2 for b in bubbles])
    db_y = DBSCAN(eps=med_h * 0.8, min_samples=1).fit(pts[:, 1].reshape(-1, 1))
    rows = {}
    for i, label in enumerate(db_y.labels_):
        rows.setdefault(label, []).append(bubbles[i])

    questions = []
    for row_bubs in rows.values():
        row_bubs = sorted(row_bubs, key=lambda b: b["x"])
        xs = [b["x"] for b in row_bubs]
        if len(xs) < 2:
            continue
        gaps = np.diff(xs)
        thresh = np.median(gaps) * 1.8 if len(gaps) else 100
        groups = []
        cur = [row_bubs[0]]
        for i, g in enumerate(gaps):
            if g > thresh:
                groups.append(cur)
                cur = [row_bubs[i + 1]]
            else:
                cur.append(row_bubs[i + 1])
        groups.append(cur)
        for g in groups:
            if 3 <= len(g) <= 6:
                g = sorted(g, key=lambda b: b["x"])
                if len(g) > 4:
                    g = g[-4:]
                ys = [b["y"] for b in g]
                if max(ys) - min(ys) > 30:
                    continue
                if len(g) == 4:
                    questions.append(g)

    # 2) Column-first ordering
    if not questions:
        return []

    # mean centre of each question
    centres = np.array(
        [
            [np.mean([b["x"] for b in q]), np.mean([b["y"] for b in q])]
            for q in questions
        ]
    )

    # cluster X centres into columns
    db_x = DBSCAN(eps=80, min_samples=1).fit(centres[:, 0].reshape(-1, 1))
    cols = {}
    for i, label in enumerate(db_x.labels_):
        cols.setdefault(label, []).append((centres[i][1], questions[i]))

    # sort columns left → right, then questions top → bottom inside each column
    sorted_cols = sorted(
        cols.items(),
        key=lambda kv: np.mean(
            [centres[i][0] for i, l in enumerate(db_x.labels_) if l == kv[0]]
        ),
    )

    questions = []
    for _, items in sorted_cols:
        items.sort(key=lambda t: t[0])  # sort by Y
        questions.extend([q for _, q in items])

    return questions


def grade_questions(warped, thresh, questions, debug=False):
    vis = warped.copy()
    answers = {}

    MARKED_COLOR = (0, 0, 255)  # Red = marked bubble
    UNMARKED_COLOR = (0, 255, 0)  # Green = all others
    BLANK_COLOR = (200, 200, 200)  # Gray = blank answer

    for idx, q in enumerate(questions, start=1):
        scores = []
        rois = []

        for b in q:
            x, y, r = b["x"], b["y"], b["r"]

            # Create a circular mask for the exact bubble area
            mask = np.zeros(thresh.shape, dtype="uint8")
            cv2.circle(mask, (x, y), r, 255, -1)

            # Count how many white pixels are inside this bubble's mask
            mask = cv2.bitwise_and(thresh, thresh, mask=mask)
            filled_pixels = cv2.countNonZero(mask)

            scores.append(filled_pixels)
            rois.append((x, y, r))

        best_idx = int(np.argmax(scores))
        best_score = scores[best_idx]
        best_radius = rois[best_idx][2]

        # Determine if it's actually filled or just a smudge
        # At least 40% of the bubble's area must be filled with pixels
        fill_threshold = (np.pi * (best_radius**2)) * 0.4

        if best_score > fill_threshold:
            # Map index to letter dynamically (e.g., 0->a, 1->b)
            options = [chr(ord("a") + i) for i in range(len(q))]
            best_opt = options[best_idx] if best_idx < len(options) else "?"
            answers[idx] = best_opt
        else:
            best_opt = None
            answers[idx] = None
            best_idx = -1

        # Draw circles
        for i, (x, y, r) in enumerate(rois):
            color = (
                BLANK_COLOR
                if answers[idx] is None
                else (MARKED_COLOR if i == best_idx else UNMARKED_COLOR)
            )
            cv2.circle(vis, (x, y), r, color, 2)

        # Annotate
        cx = int(np.mean([b["x"] for b in q]))
        cy = int(np.mean([b["y"] for b in q]))
        cv2.putText(
            vis,
            f"{idx}:{answers[idx] or '-'}",
            (cx - 25, cy - 15),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (0, 0, 255),
            1,
        )

    if debug:
        cv2.imwrite("debug_graded.jpg", vis)

    return answers, vis


def process_omr(image_path, debug=False):
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Could not load {image_path}")

    warped = warp_image(img)
    if debug:
        cv2.imwrite("debug_warped.jpg", warped)

    # Notice we capture 'thresh' here instead of 'gray'
    bubbles, thresh = detect_all_bubbles(warped, debug)
    questions = group_into_questions(bubbles)

    if not questions:
        raise ValueError(
            "No questions detected. Try adjusting width/height/aspect ratio limits in detect_all_bubbles."
        )

    # Pass 'thresh' into the grader
    answers, vis = grade_questions(warped, thresh, questions, debug)
    return answers, warped, vis


def main():
    parser = argparse.ArgumentParser(description="Generic OMR Processor v2")
    parser.add_argument("--image", required=True, help="Path to OMR image")
    parser.add_argument("--debug", action="store_true", help="Save debug images")
    args = parser.parse_args()

    answers, _, vis = process_omr(args.image, args.debug)

    print("\nDETECTED ANSWERS")
    print("=" * 30)
    for q in sorted(answers):
        print(f"Q{q:02d}: {answers[q] or 'BLANK'}")

    cv2.imwrite("omr_result_v2.jpg", vis)
    print("\nSaved omr_result_v2.jpg")


if __name__ == "__main__":
    main()
