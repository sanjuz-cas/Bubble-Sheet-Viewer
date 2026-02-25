#!/usr/bin/env python3
"""
BubbleScan OMR Processor
Core algorithm adapted from user's omr_core.py
Uses OpenCV for real computer vision bubble detection.

Usage:
  python3 omr_processor.py <image_path> <total_questions> <options_per_question>

Output:
  JSON to stdout: {"detectedAnswers": ["A","B","C",...], "confidence": [0.9,...]}
"""

import sys
import json
import cv2
import numpy as np
from imutils import contours as imutils_contours


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
    width, height = 800, 1131
    dst = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
        dtype="float32",
    )
    M = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(image, M, (width, height))


def get_bubble_centroid(contour):
    M = cv2.moments(contour)
    if M["m00"] == 0:
        x, y, w, h = cv2.boundingRect(contour)
        return (x + w // 2, y + h // 2)
    return (int(M["m10"] / M["m00"]), int(M["m01"] / M["m00"]))


def get_contours_adaptive(roi_gray):
    thresh = cv2.adaptiveThreshold(
        roi_gray, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        31, 8,
    )
    cnts, _ = cv2.findContours(thresh.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    bubbles = []
    for c in cnts:
        (_, _, w, h) = cv2.boundingRect(c)
        ar = w / float(h)
        area = cv2.contourArea(c)
        perimeter = cv2.arcLength(c, True)
        if perimeter == 0:
            continue
        circularity = 4 * np.pi * (area / (perimeter * perimeter))
        if (
            12 <= w <= 40
            and 12 <= h <= 40
            and 0.7 <= ar <= 1.3
            and circularity > 0.6
        ):
            bubbles.append(c)
    return bubbles, thresh


def cluster_answer_bubbles(bubbles, image_shape, total_questions, options_per_question):
    """
    Cluster detected bubbles into question rows.
    Splits page into left/right columns if questions > threshold.
    Returns list of detected answers (A-E) in question order.
    """
    if len(bubbles) == 0:
        return []

    h, w = image_shape
    bubble_data = []
    for b in bubbles:
        cx, cy = get_bubble_centroid(b)
        bubble_data.append({"contour": b, "x": cx, "y": cy})

    # Answer bubbles: bottom portion of image (below roll section)
    roll_threshold_y = h * 0.32
    answer_bubbles = [b for b in bubble_data if b["y"] >= roll_threshold_y]

    # Determine if we need two columns
    use_two_cols = total_questions > 20
    mid_x = w * 0.50

    if use_two_cols:
        left_q_count = (total_questions + 1) // 2
        right_q_count = total_questions // 2
        left_bubbles = [b["contour"] for b in answer_bubbles if b["x"] < mid_x]
        right_bubbles = [b["contour"] for b in answer_bubbles if b["x"] >= mid_x]
        sections = [
            {"bubbles": left_bubbles, "count": left_q_count},
            {"bubbles": right_bubbles, "count": right_q_count},
        ]
    else:
        sections = [
            {"bubbles": [b["contour"] for b in answer_bubbles], "count": total_questions},
        ]

    option_labels = ["A", "B", "C", "D", "E"][:options_per_question]
    detected_answers = []

    # Get a threshold image for pixel counting
    # We reuse the thresh from the outer call (passed via closure not possible here)
    # We'll recompute it — this is a minor overhead but keeps code clean
    return option_labels, sections


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
        image = cv2.resize(image, (int(width * scale), int(height * scale)),
                           interpolation=cv2.INTER_AREA)

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edged = cv2.Canny(blurred, 75, 200)

    # Find document corners for perspective correction
    cnts, _ = cv2.findContours(edged.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    docCnt = None
    if len(cnts) > 0:
        cnts = sorted(cnts, key=cv2.contourArea, reverse=True)
        for c in cnts:
            peri = cv2.arcLength(c, True)
            approx = cv2.approxPolyDP(c, 0.02 * peri, True)
            if len(approx) == 4:
                docCnt = approx
                break

    if docCnt is None:
        warped_gray = gray
    else:
        warped_gray = four_point_transform(gray, docCnt.reshape(4, 2))

    # Detect all bubble contours using adaptive threshold
    all_bubbles, thresh = get_contours_adaptive(warped_gray)

    img_h, img_w = warped_gray.shape
    bubble_data = []
    for b in all_bubbles:
        cx, cy = get_bubble_centroid(b)
        bubble_data.append({"contour": b, "x": cx, "y": cy})

    # Split into answer section (below roll area)
    roll_threshold_y = img_h * 0.32
    answer_bubbles_data = [b for b in bubble_data if b["y"] >= roll_threshold_y]

    # Determine column layout
    use_two_cols = total_questions > 20
    mid_x = img_w * 0.50

    option_labels = ["A", "B", "C", "D", "E"][:options_per_question]
    detected_answers = []
    confidence_scores = []

    def process_section(section_bubbles, q_count):
        """Process a single column section and return answers."""
        answers = []
        confs = []

        if len(section_bubbles) == 0:
            for _ in range(q_count):
                answers.append("")
                confs.append(0.0)
            return answers, confs

        # Sort bubbles top-to-bottom
        sorted_bubbles = imutils_contours.sort_contours(
            section_bubbles, method="top-to-bottom"
        )[0]

        # Group into rows by Y-coordinate proximity
        rows = []
        current_row = [sorted_bubbles[0]]
        for c in sorted_bubbles[1:]:
            (_, by, _, _) = cv2.boundingRect(c)
            (_, last_y, _, _) = cv2.boundingRect(current_row[-1])
            if abs(by - last_y) < 20:
                current_row.append(c)
            else:
                rows.append(current_row)
                current_row = [c]
        rows.append(current_row)

        # For each row, pick the darkest bubble
        for row_idx, row in enumerate(rows):
            if row_idx >= q_count:
                break

            # Sort left-to-right within row
            row = imutils_contours.sort_contours(row, method="left-to-right")[0]

            # Filter to expected number of options: take the N largest by area
            if len(row) > options_per_question:
                row = sorted(row, key=cv2.contourArea, reverse=True)[:options_per_question]
                row = imutils_contours.sort_contours(row, method="left-to-right")[0]

            if len(row) < 2:
                answers.append("")
                confs.append(0.0)
                continue

            # Count filled pixels in each bubble
            pixels = []
            for c in row:
                mask = np.zeros(thresh.shape, dtype="uint8")
                cv2.drawContours(mask, [c], -1, 255, -1)
                masked = cv2.bitwise_and(thresh, thresh, mask=mask)
                pixels.append(cv2.countNonZero(masked))

            total_pixels = sum(pixels)
            best_idx = int(np.argmax(pixels))
            best_pixels = pixels[best_idx]

            # Confidence: ratio of best vs total fill
            conf = best_pixels / max(total_pixels, 1)

            # Require the winner to be meaningfully filled to avoid blank bubbles
            # Use a relative threshold: best must be > 25% of total pixels seen
            if best_pixels > 30 and conf > 0.25:
                if best_idx < len(option_labels):
                    answers.append(option_labels[best_idx])
                else:
                    answers.append("")
                confs.append(min(1.0, conf))
            else:
                answers.append("")
                confs.append(0.0)

        # Pad if fewer rows detected than expected
        while len(answers) < q_count:
            answers.append("")
            confs.append(0.0)

        return answers[:q_count], confs[:q_count]

    if use_two_cols:
        left_q_count = (total_questions + 1) // 2
        right_q_count = total_questions - left_q_count

        left_contours = [b["contour"] for b in answer_bubbles_data if b["x"] < mid_x]
        right_contours = [b["contour"] for b in answer_bubbles_data if b["x"] >= mid_x]

        left_answers, left_conf = process_section(left_contours, left_q_count)
        right_answers, right_conf = process_section(right_contours, right_q_count)

        detected_answers = left_answers + right_answers
        confidence_scores = left_conf + right_conf
    else:
        all_contours = [b["contour"] for b in answer_bubbles_data]
        detected_answers, confidence_scores = process_section(all_contours, total_questions)

    return {
        "detectedAnswers": detected_answers,
        "confidence": confidence_scores,
    }


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print(json.dumps({"error": "Usage: omr_processor.py <image_path> <total_questions> <options_per_question>"}))
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
