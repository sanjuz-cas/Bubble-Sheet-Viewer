#!/usr/bin/env python3
"""
BubbleScan OMR Processor

The supported sheet is the uploaded BubbleScan template:
  * A4-like portrait page with registration corners
  * 6 set bubbles
  * 5 roll-number columns with 10 digits each
  * 2 answer columns, 5 rows each, with up to 6 options (A-F)

The template is read from calibrated, page-relative coordinates after the
perspective correction.  This is deliberately more stable than detecting the
printed circle outlines as contours: outlines, table borders, and text all
produce similarly sized contours in a camera image.

Usage:
  python3 omr_processor.py <image_path> <total_questions> <options_per_question>

Output:
  JSON to stdout: {"detectedAnswers": [["A"],["B","C"],...], "confidence": [0.9,...]}
"""

import sys
import json
import cv2
import numpy as np


def grab_contours(cnts):
    """Handle OpenCV 3.x vs 4.x findContours return value difference."""
    if len(cnts) == 2:
        return cnts[0]
    elif len(cnts) == 3:
        return cnts[1]
    else:
        raise ValueError("Unexpected findContours return value")


def order_points(pts):
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def four_point_transform(image, pts):
    rect = order_points(pts)
    # The supplied template's printable page is approximately 2:3.  Keeping
    # this aspect ratio prevents the fixed calibration points from drifting.
    width, height = 800, 1200
    dst = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
        dtype="float32",
    )
    M = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(image, M, (width, height))


CANVAS_SIZE = (800, 1200)

# Coordinates are measured from the uploaded template's page rectangle and
# stored as fractions so the same calibration survives camera resolutions.
# The source image page is 1020 x 1530; these values intentionally use the
# centers of the printed circles, not their outer contour.
SET_POINTS = [(x / 1020.0, 212 / 1530.0) for x in (250, 356, 460, 566, 668, 770)]
ROLL_X = [x / 1020.0 for x in (250, 386, 524, 660, 794)]
ROLL_Y = [y / 1530.0 for y in (436, 484, 532, 580, 628, 676, 724, 772, 820, 868)]
ANSWER_X = [
    x / 1020.0
    for x in (178, 236, 294, 352, 410, 468, 616, 674, 734, 792, 850, 908)
]
ANSWER_Y = [y / 1530.0 for y in (1082, 1148, 1216, 1284, 1352)]


def calibrated_point(x_fraction, y_fraction):
    return (
        int(round(x_fraction * CANVAS_SIZE[0])),
        int(round(y_fraction * CANVAS_SIZE[1])),
    )


def sample_mark_score(gray, point):
    """Return ink density in a bubble center, normalized for lighting.

    The printed outline is outside the inner disk.  Comparing the center to
    a nearby background annulus makes this work with both flat scans and
    unevenly lit phone photos.
    """
    x, y = point
    inner_radius = 5
    outer_inner_radius = 12
    outer_radius = 16
    inner_mask = np.zeros(gray.shape, dtype=np.uint8)
    outer_mask = np.zeros(gray.shape, dtype=np.uint8)
    cv2.circle(inner_mask, (x, y), inner_radius, 255, -1)
    cv2.circle(outer_mask, (x, y), outer_radius, 255, -1)
    cv2.circle(outer_mask, (x, y), outer_inner_radius, 0, -1)
    inner = cv2.mean(gray, mask=inner_mask)[0]
    outer = cv2.mean(gray, mask=outer_mask)[0]
    # A blank center is close to the surrounding paper; a pencil/pen mark is
    # substantially darker. Clamp small print/scanner variations to zero.
    return max(0.0, min(1.0, (outer - inner) / 255.0))


def read_calibrated_grid(gray, points, labels):
    scores = [sample_mark_score(gray, point) for point in points]
    best_idx = int(np.argmax(scores)) if scores else 0
    best = scores[best_idx] if scores else 0.0
    second = sorted(scores, reverse=True)[1] if len(scores) > 1 else 0.0

    # The unmarked template has scores around zero.  Require both meaningful
    # ink and separation from the next choice to avoid calling scan noise a
    # response.
    marked = best >= 0.12 and (best - second >= 0.035 or best >= 0.28)
    return (labels[best_idx] if marked else "", best if marked else 0.0, scores)


def read_marked_grid(gray, points, labels):
    """Return every bubble with meaningful ink for multi-answer questions."""
    scores = [sample_mark_score(gray, point) for point in points]
    marked_labels = [
        label for label, score in zip(labels, scores) if score >= 0.12
    ]
    confidence = max((score for score in scores if score >= 0.12), default=0.0)
    return marked_labels, confidence, scores


def find_page_contour(gray, min_area_ratio=0.20):
    """Find the portrait paper rectangle in a scan or a photographed sheet.

    Edge-only detection is unreliable when a white page sits on a textured
    desk: part of the page edge can be faint, which makes the old fallback
    calibrate to the entire photograph.  First try the page edge, then use a
    bright-paper mask as a camera-photo fallback.
    """
    image_area = gray.shape[0] * gray.shape[1]

    def pick_rectangle(contours):
        for contour in sorted(contours, key=cv2.contourArea, reverse=True):
            if cv2.contourArea(contour) < image_area * min_area_ratio:
                continue
            perimeter = cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, 0.02 * perimeter, True)
            if len(approx) != 4:
                continue
            _, _, width, height = cv2.boundingRect(approx)
            if height / max(width, 1) > 1.1:
                return approx
        return None

    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    edges = cv2.dilate(
        edges, cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3)), iterations=2
    )
    contours = grab_contours(
        cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    )
    page = pick_rectangle(contours)
    if page is not None:
        return page

    # A sheet on a darker/table background is normally the largest bright
    # region. Closing bridges text and shadow gaps before extracting its edge.
    _, paper = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    paper = cv2.morphologyEx(
        paper,
        cv2.MORPH_CLOSE,
        cv2.getStructuringElement(cv2.MORPH_RECT, (21, 21)),
        iterations=2,
    )
    contours = grab_contours(
        cv2.findContours(paper, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    )
    return pick_rectangle(contours)


def fallback_process(image_path, total_questions, options_per_question):
    """
    Original hardcoded fractional coordinate OMR pipeline.
    """
    image = cv2.imread(image_path)
    if image is None:
        raise ValueError(f"Could not read image: {image_path}")

    # Resize if too large
    max_dimension = 1920
    height, width = image.shape[:2]
    if max(height, width) > max_dimension:
        scale = max_dimension / max(height, width)
        image = cv2.resize(
            image,
            (int(width * scale), int(height * scale)),
            interpolation=cv2.INTER_AREA,
        )

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    # Use the same page detector as the primary path.  In particular, do not
    # require a paper rectangle to occupy nearly the entire camera frame.
    docCnt = find_page_contour(gray, min_area_ratio=0.20)

    if docCnt is None:
        # A scan can be tightly cropped or have a very faint page border. The
        # template-relative fallback still gives predictable geometry.
        warped_gray = cv2.resize(gray, CANVAS_SIZE, interpolation=cv2.INTER_AREA)
        print("DEBUG [Replit]: Page border not found; using full-frame calibration", file=sys.stderr)
    else:
        warped_gray = four_point_transform(gray, docCnt.reshape(4, 2))

    # Read the six set bubbles and roll number with the same calibration. They
    # are returned for diagnostics/evaluation while answer grading remains
    # backward-compatible with the existing client.
    set_labels = [f"SET {i}" for i in range(1, 7)]
    set_result = read_calibrated_grid(
        warped_gray,
        [calibrated_point(x, y) for x, y in SET_POINTS],
        set_labels,
    )

    roll_digits = []
    roll_confidence = []
    for x in ROLL_X:
        digit_result = read_calibrated_grid(
            warped_gray,
            [calibrated_point(x, y) for y in ROLL_Y],
            [str(i) for i in range(10)],
        )
        roll_digits.append(digit_result[0])
        roll_confidence.append(digit_result[1])

    # The physical answer area is always two columns.  Limit the requested
    # option count to the six choices printed on this template.
    option_count = max(1, min(6, int(options_per_question)))
    option_labels = ["A", "B", "C", "D", "E", "F"][:option_count]
    left_x = ANSWER_X[:6][:option_count]
    right_x = ANSWER_X[6:][:option_count]
    left_q_count = min(5, (total_questions + 1) // 2)
    right_q_count = min(5, max(0, total_questions - left_q_count))

    detected_answers = []
    confidence_scores = []

    def process_answer_column(x_values, q_count):
        answers = []
        confs = []
        for y in ANSWER_Y[:q_count]:
            answer_result = read_marked_grid(
                warped_gray,
                [calibrated_point(x, y) for x in x_values],
                option_labels,
            )
            answers.append(answer_result[0])
            confs.append(answer_result[1])
        return answers, confs

    left_answers, left_conf = process_answer_column(
        [x / 1020.0 for x in (178, 236, 294, 352, 410, 468)][:option_count],
        left_q_count,
    )
    right_answers, right_conf = process_answer_column(
        [x / 1020.0 for x in (616, 674, 734, 792, 850, 908)][:option_count],
        right_q_count,
    )

    detected_answers = left_answers + right_answers
    confidence_scores = left_conf + right_conf
    while len(detected_answers) < total_questions:
        detected_answers.append([])
        confidence_scores.append(0.0)

    print(
        f"DEBUG [Replit]: calibrated template; set={set_result[0] or 'blank'} "
        f"roll={''.join(roll_digits) or 'blank'} answers={len(detected_answers)}",
        file=sys.stderr,
    )

    return {
        "detectedAnswers": detected_answers[:total_questions],
        "confidence": confidence_scores[:total_questions],
        "detectedSet": set_result[0],
        "detectedRollNumber": "".join(roll_digits),
        "rollConfidence": roll_confidence,
    }


def process_omr_image(image_path, total_questions, options_per_question):
    """
    Robust dynamic OMR pipeline that:
    1. Isolates the OMR sheet from the background via perspective transform
    2. Finds and clusters bubbles dynamically on the isolated page
    Falls back to hardcoded coordinates if dynamic extraction fails.
    """
    image = cv2.imread(image_path)
    if image is None:
        raise ValueError(f"Could not read image: {image_path}")

    # --- Step 1: Isolate the page from the background ---
    orig_gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    orig_h, orig_w = orig_gray.shape

    # Resize for processing
    proc_scale = 1200.0 / max(orig_h, 1)
    proc_gray = cv2.resize(orig_gray, (int(orig_w * proc_scale), 1200), interpolation=cv2.INTER_AREA)
    proc_h, proc_w = proc_gray.shape

    page_cnt = find_page_contour(proc_gray, min_area_ratio=0.20)

    if page_cnt is not None:
        # Perspective-transform to a clean 800x1200 canvas
        warped = four_point_transform(proc_gray, page_cnt.reshape(4, 2))
        print("DEBUG [OMR]: Page isolated via perspective transform", file=sys.stderr)
    else:
        # No page border found - assume the image IS the page (e.g. a flat scan)
        warped = cv2.resize(proc_gray, CANVAS_SIZE, interpolation=cv2.INTER_AREA)
        print("DEBUG [OMR]: No page border found; using full frame", file=sys.stderr)

    # --- Step 2: Detect bubbles on the ISOLATED page only ---
    gray = warped
    thresh = cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 51, 15
    )
    cnts = cv2.findContours(thresh, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    cnts = grab_contours(cnts)

    bubbles = []
    for c in cnts:
        x, y, w, h = cv2.boundingRect(c)
        aspect = w / float(max(h, 1))
        if 0.7 <= aspect <= 1.4:
            area = cv2.contourArea(c)
            if 80 < area < 2000:
                perimeter = cv2.arcLength(c, True)
                if perimeter > 0:
                    circularity = 4 * np.pi * (area / (perimeter * perimeter))
                    if circularity > 0.55:
                        bubbles.append((int(x + w / 2), int(y + h / 2), w, h))

    # Deduplicate nearby bubbles
    unique_bubbles = []
    for b in bubbles:
        if not any(np.hypot(b[0] - ub[0], b[1] - ub[1]) < 12 for ub in unique_bubbles):
            unique_bubbles.append(b)

    unique_bubbles.sort(key=lambda b: b[1])

    # --- Step 3: Cluster bubbles into rows ---
    rows = []
    current_row = []
    for b in unique_bubbles:
        if not current_row:
            current_row.append(b)
        else:
            if abs(b[1] - current_row[0][1]) < 18:
                current_row.append(b)
            else:
                rows.append(current_row)
                current_row = [b]
    if current_row:
        rows.append(current_row)

    for r in rows:
        r.sort(key=lambda b: b[0])

    print(f"DEBUG [OMR]: Found {len(unique_bubbles)} bubbles in {len(rows)} rows "
          f"(row sizes: {[len(r) for r in rows]})", file=sys.stderr)

    valid_rows = [r for r in rows if len(r) >= 5]

    if len(valid_rows) < 16:
        print(f"DEBUG [OMR]: Dynamic grid failed ({len(valid_rows)} valid rows < 16). Using fallback.", file=sys.stderr)
        return fallback_process(image_path, total_questions, options_per_question)

    # --- Step 4: Identify structural blocks ---
    # Find the ROLL block: 10 consecutive rows of exactly 5 bubbles each
    roll_start = -1
    for i in range(len(valid_rows) - 9):
        if all(len(valid_rows[i + j]) == 5 for j in range(10)):
            roll_start = i
            break

    if roll_start == -1:
        print("DEBUG [OMR]: Dynamic grid failed (ROLL block not found).", file=sys.stderr)
        return fallback_process(image_path, total_questions, options_per_question)

    # SET row: the closest row with 6 bubbles above the roll block
    set_row = None
    for i in range(roll_start - 1, -1, -1):
        if len(valid_rows[i]) == 6:
            set_row = valid_rows[i]
            break

    # ANSWER rows: rows with >=7 bubbles (two columns of options) after the roll block
    answer_rows = []
    for r in valid_rows[roll_start + 10:]:
        if len(r) >= 7:
            answer_rows.append(r)

    if not set_row or len(answer_rows) < 5:
        print(f"DEBUG [OMR]: Dynamic grid failed (set={set_row is not None}, "
              f"answer_rows={len(answer_rows)}).", file=sys.stderr)
        return fallback_process(image_path, total_questions, options_per_question)

    answer_rows = answer_rows[:5]

    # --- Step 5: Read marks ---
    def eval_b(b):
        return sample_mark_score(gray, (b[0], b[1]))

    # SET detection
    set_scores = [eval_b(b) for b in set_row]
    best_set = int(np.argmax(set_scores)) if set_scores else 0
    set_result = f"SET {best_set + 1}" if (set_scores and set_scores[best_set] >= 0.12) else ""

    # ROLL NUMBER (digits 0-9)
    roll_digits = []
    roll_confs = []
    for col in range(5):
        col_scores = [eval_b(valid_rows[roll_start + row][col]) for row in range(10)]
        best_idx = int(np.argmax(col_scores))
        if col_scores[best_idx] >= 0.12:
            roll_digits.append(str(best_idx))
            roll_confs.append(col_scores[best_idx])
        else:
            roll_digits.append("")
            roll_confs.append(0.0)

    # ANSWERS
    detected_answers = []
    confidence_scores = []
    option_labels = ["A", "B", "C", "D", "E", "F"]
    opts = int(options_per_question)

    for ans_row in answer_rows:
        # Split the row into left and right columns using the gap in the middle
        xs = [b[0] for b in ans_row]
        # Find the largest gap to split left/right columns
        gaps = [(xs[i + 1] - xs[i], i) for i in range(len(xs) - 1)]
        gaps.sort(reverse=True)
        if gaps:
            split_idx = gaps[0][1] + 1
        else:
            split_idx = len(ans_row) // 2

        left_bubbles = ans_row[:split_idx]
        right_bubbles = ans_row[split_idx:]

        for col_bubbles in [left_bubbles, right_bubbles]:
            if len(detected_answers) >= total_questions:
                break
            # Skip the first bubble if it looks like a Q.No marker (narrower column)
            actual_bubbles = col_bubbles
            if len(actual_bubbles) > opts:
                # The first element is likely the Q.No. marker - skip it
                actual_bubbles = actual_bubbles[1:]
            if len(actual_bubbles) > opts:
                actual_bubbles = actual_bubbles[:opts]

            if len(actual_bubbles) < opts:
                detected_answers.append([])
                confidence_scores.append(0.0)
                continue

            scores = [eval_b(b) for b in actual_bubbles]
            marked = [option_labels[i] for i, s in enumerate(scores) if s >= 0.12]
            conf = max(scores) if scores else 0.0
            detected_answers.append(marked)
            confidence_scores.append(conf)

    while len(detected_answers) < total_questions:
        detected_answers.append([])
        confidence_scores.append(0.0)

    print(f"DEBUG [OMR]: Dynamic grid successful; set={set_result} "
          f"roll={''.join(roll_digits)} answers={len(detected_answers)}", file=sys.stderr)

    return {
        "detectedAnswers": detected_answers[:total_questions],
        "confidence": confidence_scores[:total_questions],
        "detectedSet": set_result,
        "detectedRollNumber": "".join(roll_digits),
        "rollConfidence": roll_confs,
    }


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(
            json.dumps(
                {
                    "error": "Usage: omr_processor.py <image_path> <total_questions> <options_per_question>"
                }
            )
        )
        sys.exit(1)

    image_path = sys.argv[1]
    total_questions = int(sys.argv[2])
    options_per_question = int(sys.argv[3])

    try:
        result = process_omr_image(image_path, total_questions, options_per_question)
        print(json.dumps(result))
    except Exception as e:
        import traceback

        print(json.dumps({"error": str(e), "trace": traceback.format_exc()}))
        sys.exit(1)
