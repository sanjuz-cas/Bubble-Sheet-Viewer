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
  JSON to stdout: {"detectedAnswers": ["A","B","C",...], "confidence": [0.9,...]}
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


def process_omr_image(image_path, total_questions, options_per_question):
    """
    Full OMR pipeline matching user's original algorithm.
    Returns dict with detectedAnswers (list of letter strings) and confidence.
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
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edged = cv2.Canny(blurred, 75, 200)

    # Find document corners for perspective correction
    cnts = cv2.findContours(edged.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cnts = grab_contours(cnts)
    docCnt = None
    if len(cnts) > 0:
        image_area = gray.shape[0] * gray.shape[1]
        cnts = sorted(cnts, key=cv2.contourArea, reverse=True)
        for c in cnts:
            contour_area = cv2.contourArea(c)
            # Do not mistake the answer table or a registration mark for the
            # page. A valid page outline is a large portrait rectangle.
            if contour_area < image_area * 0.70:
                continue
            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.02 * peri, True)
            if len(approx) == 4:
                _, _, contour_width, contour_height = cv2.boundingRect(approx)
                if contour_height / max(contour_width, 1) < 1.20:
                    continue
                docCnt = approx
                break

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
            answer_result = read_calibrated_grid(
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
        detected_answers.append("")
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
