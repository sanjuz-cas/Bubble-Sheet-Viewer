"""
omr_processor.py - Adaptive Topological Grid Matching for OMR
Implements:
- Homography via outer border
- HoughCircles bubble detection
- DBSCAN row clustering with adaptive Y-tolerance
- Automatic left/right column split
- Simple darkness grading
Usage:
    python omr_processor.py --image path/to/omr.jpg [--debug]
"""

import cv2
import numpy as np
import argparse
from sklearn.cluster import DBSCAN


def order_points(pts):
    """Return points ordered as tl, tr, br, bl."""
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).flatten()
    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmin(diff)]
    bl = pts[np.argmax(diff)]
    return np.array([tl, tr, br, bl], dtype=np.float32)


def find_document_corners(image):
    """Find the outer rectangular border of OMR sheet."""
    h, w = image.shape[:2]
    small = cv2.resize(image, (1200, int(1200 * h / w)))
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blur, 50, 150)

    # OpenCV 3.x returns 3 values, 4.x returns 2. Normalize.
    cnts = cv2.findContours(
        image=edges,
        mode=cv2.RETR_EXTERNAL,
        method=cv2.CHAIN_APPROX_SIMPLE,
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
            [[x, y], [x + wc, y], [x + wc, y + hc], [x, y + hc]],
            dtype=np.float32,
        )

    pts = approx.reshape(-1, 2).astype(np.float32)
    src_small = order_points(pts)

    scale_x = w / 1200
    scale_y = h / small.shape[0]
    src = src_small * np.array([scale_x, scale_y])
    return src.astype(np.float32)


def warp_image(image, dst_size=(800, 1100)):
    """Warp image to a fixed size using perspective transform from corners."""
    src = find_document_corners(image)
    dst = np.float32(
        [[0, 0], [dst_size[0], 0], [dst_size[0], dst_size[1]], [0, dst_size[1]]]
    )
    matrix = cv2.getPerspectiveTransform(src, dst)
    warped = cv2.warpPerspective(image, matrix, dst_size)
    return warped


def detect_bubbles(warped, debug=False):
    """Detect bubble candidates with HoughCircles and circularity filter."""
    gray = cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
    h, _ = gray.shape
    y_start = int(h * 0.32)

    roi = gray[y_start:, :]
    blur = cv2.medianBlur(roi, 5)

    circles = cv2.HoughCircles(
        blur,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=18,
        param1=100,
        param2=15,
        minRadius=8,
        maxRadius=17,
    )

    candidates = []
    if circles is not None:
        for x, y, r in np.uint16(np.around(circles[0])):
            y_full = y + y_start
            if not h * 0.33 < y_full < h * 0.86:
                continue

            patch = gray[
                max(0, y_full - r - 3) : y_full + r + 3,
                max(0, x - r - 3) : x + r + 3,
            ]
            _, th = cv2.threshold(
                patch, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU
            )

            cnts = cv2.findContours(
                image=th,
                mode=cv2.RETR_EXTERNAL,
                method=cv2.CHAIN_APPROX_SIMPLE,
            )
            cnts = cnts[0] if len(cnts) == 2 else cnts[1]
            if not cnts:
                continue

            c = max(cnts, key=cv2.contourArea)
            area = cv2.contourArea(c)
            peri = cv2.arcLength(c, True)
            if peri == 0:
                continue
            circ = 4 * np.pi * area / (peri * peri)
            if circ < 0.68:
                continue

            candidates.append(
                {"x": int(x), "y": int(y_full), "r": int(r), "circ": circ}
            )

    if not candidates:
        return [], gray

    pts = np.array([[c["x"], c["y"]] for c in candidates])
    med_h = np.median([c["r"] * 2 for c in candidates])
    db = DBSCAN(eps=med_h * 0.9, min_samples=2).fit(pts[:, 1].reshape(-1, 1))

    final = []
    for label in set(db.labels_):
        if label == -1:
            continue
        row = [candidates[i] for i in range(len(candidates)) if db.labels_[i] == label]
        mid_x = np.median([p["x"] for p in row])
        for side in (
            [p for p in row if p["x"] < mid_x],
            [p for p in row if p["x"] >= mid_x],
        ):
            if len(side) < 3:
                continue
            side = sorted(side, key=lambda p: p["circ"], reverse=True)[:4]
            side = sorted(side, key=lambda p: p["x"])
            final.extend(side)

    if debug:
        dbg = warped.copy()
        for b in final:
            cv2.circle(dbg, (b["x"], b["y"]), b["r"], (0, 255, 0), 2)
        cv2.imwrite("debug_bubbles_fixed.jpg", dbg)

    return final, gray


def cluster_rows(bubbles):
    """Adaptive Y-tolerance using DBSCAN."""
    if len(bubbles) < 4:
        return []

    pts = np.array([[b["x"], b["y"]] for b in bubbles])
    med_h = np.median([b["r"] * 2 for b in bubbles])

    db = DBSCAN(eps=med_h * 0.8, min_samples=2).fit(pts[:, 1].reshape(-1, 1))
    rows = {}
    for i, label in enumerate(db.labels_):
        if label == -1:
            continue
        rows.setdefault(label, []).append(bubbles[i])

    def row_mean_y(label):
        return np.mean([b["y"] for b in rows[label]])

    sorted_rows = []
    for label in sorted(rows.keys(), key=row_mean_y):
        sorted_rows.append(sorted(rows[label], key=lambda b: b["x"]))
    return sorted_rows


def grade_sheet(warped, bubbles, gray, debug=False):
    """Grade using adaptive grid matching."""
    rows = cluster_rows(bubbles)
    if not rows:
        raise ValueError("No rows detected")

    answers = {}
    vis = warped.copy()

    for row_idx, row in enumerate(rows[:5]):
        if len(row) < 4:
            continue
        xs = [b["x"] for b in row]
        mid_x = np.median(xs)

        left = sorted([b for b in row if b["x"] < mid_x], key=lambda b: b["x"])[:4]
        right = sorted([b for b in row if b["x"] >= mid_x], key=lambda b: b["x"])[:4]

        for side_bubbles, q_num in ((left, row_idx + 1), (right, row_idx + 6)):
            if len(side_bubbles) != 4:
                continue

            best_opt = None
            best_score = -1

            for opt_idx, bubble in enumerate(side_bubbles):
                x, y, r = bubble["x"], bubble["y"], bubble["r"]
                y1, y2 = max(0, y - r), min(gray.shape[0], y + r)
                x1, x2 = max(0, x - r), min(gray.shape[1], x + r)
                roi = gray[y1:y2, x1:x2]
                if roi.size == 0:
                    continue

                darkness = np.mean(255 - roi)
                color = (0, 255, 0) if darkness > 40 else (200, 200, 200)
                cv2.circle(vis, (x, y), r, color, 2)

                if darkness > best_score:
                    best_score = darkness
                    best_opt = ["a", "b", "c", "d"][opt_idx]

            if best_score > 35:
                answers[q_num] = best_opt
                bx = side_bubbles[0]["x"]
                by = side_bubbles[0]["y"]
                cv2.putText(
                    vis,
                    f"Q{q_num}:{best_opt}",
                    (bx - 30, by - 15),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    (0, 0, 255),
                    1,
                )
            else:
                answers[q_num] = None

    if debug:
        cv2.imwrite("debug_graded.jpg", vis)
    return answers, vis


def process_omr(image_path, debug=False):
    """Main processing pipeline."""
    print(f"Processing {image_path}...")
    img = cv2.imread(image_path)
    if img is None:
        raise ValueError(f"Could not load image: {image_path}")

    print(" - Finding document corners and warping...")
    warped = warp_image(img)
    if debug:
        cv2.imwrite("debug_warped.jpg", warped)

    print(" - Detecting bubbles...")
    bubbles, gray = detect_bubbles(warped, debug)
    print(f" - Found {len(bubbles)} bubbles")

    print(" - Clustering rows and grading...")
    answers, vis = grade_sheet(warped, bubbles, gray, debug)
    return answers, warped, vis


def main():
    """CLI entry point."""
    parser = argparse.ArgumentParser(description="Adaptive OMR Processor")
    parser.add_argument("--image", required=True, help="Path to OMR sheet image")
    parser.add_argument("--debug", action="store_true", help="Save debug images")
    args = parser.parse_args()

    try:
        answers, _, vis = process_omr(args.image, args.debug)

        print("\n" + "=" * 40)
        print("DETECTED ANSWERS:")
        print("=" * 40)
        for q in sorted(answers.keys()):
            ans = answers[q] if answers[q] else "BLANK"
            print(f"Question {q:2d}: {ans}")

        cv2.imwrite("omr_result.jpg", vis)
        print("\nResult visualization saved to omr_result.jpg")
        if args.debug:
            print(
                "Debug images: debug_warped.jpg, debug_bubbles_fixed.jpg, "
                "debug_graded.jpg"
            )

    except ValueError as e:
        print(f"Processing error: {e}")
        import traceback

        traceback.print_exc()
        return 1
    except OSError as e:
        print(f"I/O error: {e}")
        import traceback

        traceback.print_exc()
        return 1
    except RuntimeError as e:
        print(f"OpenCV runtime error: {e}")
        import traceback

        traceback.print_exc()
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
