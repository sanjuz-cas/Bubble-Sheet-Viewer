from flask import Flask, render_template, request, jsonify
import cv2
import numpy as np
import base64
import os
from datetime import datetime
from imutils import contours as imutils_contours

app = Flask(
    __name__,
    template_folder="../public",
    static_folder="../public",
    static_url_path="/",
)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024 * 1024  # 16MB max upload

# Create uploads folder
UPLOAD_FOLDER = os.path.join(os.path.dirname(__file__), "uploads")
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# --- CONFIGURATION ---
ANSWER_KEY = {
    1: "c",
    2: "a",
    3: "b",
    4: "d",
    5: "b",
    6: "a",
    7: "c",
    8: "d",
    9: "a",
    10: "b",
}
OPTIONS = ["a", "b", "c", "d"]


def order_points(pts):
    rect = np.zeros((4, 2), dtype="float32")
    s = pts.sum(axis=1)
    rect[0] = pts[np.argmin(s)]
    rect[2] = pts[np.argmax(s)]
    diff = np.diff(pts, axis=1)
    rect[1] = pts[np.argmin(diff)]
    rect[3] = pts[np.argmax(diff)]
    return rect


def four_point_transform_A4(image, pts):
    rect = order_points(pts)
    width, height = 800, 1131  # Optimized A4 resolution for faster processing
    dst = np.array(
        [[0, 0], [width - 1, 0], [width - 1, height - 1], [0, height - 1]],
        dtype="float32",
    )
    M = cv2.getPerspectiveTransform(rect, dst)
    return cv2.warpPerspective(image, M, (width, height))


def get_contours_adaptive(roi_gray):
    thresh = cv2.adaptiveThreshold(
        roi_gray,
        255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
        cv2.THRESH_BINARY_INV,
        31,
        8,
    )
    cnts, _ = cv2.findContours(
        thresh.copy(), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )
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
            w >= 12
            and w <= 40
            and h >= 12
            and h <= 40
            and 0.7 <= ar <= 1.3
            and circularity > 0.6
        ):
            bubbles.append(c)

    return bubbles, thresh


def get_bubble_centroid(contour):
    """Get the centroid (x, y) of a bubble contour"""
    M = cv2.moments(contour)
    if M["m00"] == 0:
        x, y, w, h = cv2.boundingRect(contour)
        return (x + w // 2, y + h // 2)
    cx = int(M["m10"] / M["m00"])
    cy = int(M["m01"] / M["m00"])
    return (cx, cy)


def cluster_bubbles_by_sections(bubbles, image_shape):
    """Cluster bubbles into sections: roll number, left answers, right answers"""
    if len(bubbles) == 0:
        return {"roll": [], "left_answers": [], "right_answers": []}
    
    h, w = image_shape
    bubble_data = []
    
    # Get centroid positions for all bubbles
    for bubble in bubbles:
        cx, cy = get_bubble_centroid(bubble)
        bubble_data.append({"contour": bubble, "x": cx, "y": cy})
    
    # Roll number section: top 30% AND left 35% of image
    roll_threshold_y = h * 0.32
    roll_threshold_x = w * 0.33  # Balanced to capture roll numbers but exclude SET section
    roll_bubbles = [b for b in bubble_data 
                    if b["y"] < roll_threshold_y and b["x"] < roll_threshold_x]
    
    # Answer bubbles: below roll number section
    answer_bubbles = [b for b in bubble_data if b["y"] >= roll_threshold_y]
    
    # Separate answers by X-coordinate: left vs right half
    mid_x = w * 0.50
    left_bubbles = [b for b in answer_bubbles if b["x"] < mid_x]
    right_bubbles = [b for b in answer_bubbles if b["x"] >= mid_x]
    
    return {
        "roll": [b["contour"] for b in roll_bubbles],
        "left_answers": [b["contour"] for b in left_bubbles],
        "right_answers": [b["contour"] for b in right_bubbles]
    }


def process_omr_image(image):
    """Process OMR image and return results using adaptive clustering"""
    # Resize if image is too large for faster processing
    max_dimension = 1920
    height, width = image.shape[:2]
    if max(height, width) > max_dimension:
        scale = max_dimension / max(height, width)
        new_width = int(width * scale)
        new_height = int(height * scale)
        image = cv2.resize(image, (new_width, new_height), interpolation=cv2.INTER_AREA)

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edged = cv2.Canny(blurred, 75, 200)

    # Find Document Corners
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
        warped_color = image.copy()
    else:
        warped_gray = four_point_transform_A4(gray, docCnt.reshape(4, 2))
        warped_color = four_point_transform_A4(image, docCnt.reshape(4, 2))
    
    # ==========================================
    # DETECT ALL BUBBLES IN THE IMAGE
    # ==========================================
    all_bubbles, thresh = get_contours_adaptive(warped_gray)
    
    # Cluster bubbles into sections
    sections = cluster_bubbles_by_sections(all_bubbles, warped_gray.shape)

    # ==========================================
    # 1. ROLL NUMBER DETECTION (from clustered bubbles)
    # ==========================================
    detected_roll = ""
    roll_bubbles = sections["roll"]
    
    # Debug: Print roll bubble count
    print(f"DEBUG: Found {len(roll_bubbles)} roll number bubbles")
    if len(roll_bubbles) > 0:
        x_coords = [get_bubble_centroid(b)[0] for b in roll_bubbles]
        print(f"DEBUG: Roll bubble X-range: {min(x_coords):.0f} to {max(x_coords):.0f} (threshold: {warped_gray.shape[1] * 0.38:.0f})")        # Show X-coordinate distribution
        sorted_x = sorted(x_coords)
        print(f"DEBUG: All bubble X-coords: {[f'{x:.0f}' for x in sorted_x]}")
    if len(roll_bubbles) > 0:
        # Sort all bubbles left to right first
        roll_bubbles = imutils_contours.sort_contours(
            roll_bubbles, method="left-to-right"
        )[0]
        
        # Group bubbles into columns by X-coordinate clustering
        columns = []
        if len(roll_bubbles) > 0:
            current_col = [roll_bubbles[0]]
            
            for i in range(1, len(roll_bubbles)):
                # Get average X of current column
                col_x_coords = [cv2.boundingRect(b)[0] for b in current_col]
                avg_x = sum(col_x_coords) / len(col_x_coords)
                
                curr_x, _, _, _ = cv2.boundingRect(roll_bubbles[i])
                
                # If bubble is within 15px of column average, add to column
                if abs(curr_x - avg_x) <= 15:
                    current_col.append(roll_bubbles[i])
                else:
                    # Start new column
                    # Only save previous column if it has 8-11 bubbles (allowing 1 stray)
                    if 8 <= len(current_col) <= 11:
                        columns.append(current_col)
                    current_col = [roll_bubbles[i]]
            
            # Add the last column if it's a valid digit column
            if 8 <= len(current_col) <= 11:
                columns.append(current_col)
        
        # Clean up columns: remove outliers if column has >10 bubbles
        cleaned_columns = []
        for col in columns:
            if len(col) > 10:
                # Calculate mean X-coordinate
                x_coords = [cv2.boundingRect(b)[0] for b in col]
                mean_x = sum(x_coords) / len(x_coords)
                
                # Find bubble farthest from mean
                max_dist = 0
                outlier_idx = 0
                for i, b in enumerate(col):
                    x = cv2.boundingRect(b)[0]
                    dist = abs(x - mean_x)
                    if dist > max_dist:
                        max_dist = dist
                        outlier_idx = i
                
                # Remove outlier if it's >8px from mean
                if max_dist > 8:
                    col = col[:outlier_idx] + col[outlier_idx+1:]
            
            cleaned_columns.append(col)
        
        columns = cleaned_columns
        
        # Debug: Print column information
        print(f"DEBUG: Detected {len(columns)} columns for roll number")
        for idx, col in enumerate(columns):
            print(f"  Column {idx+1}: {len(col)} bubbles")

        # Process each column to extract digit
        for col_bubbles in columns:
            # Sort bubbles top to bottom within column
            col_bubbles = imutils_contours.sort_contours(
                col_bubbles, method="top-to-bottom"
            )[0]
            
            # Count filled pixels in each bubble
            pixels = []
            for c in col_bubbles:
                mask = np.zeros(thresh.shape, dtype="uint8")
                cv2.drawContours(mask, [c], -1, 255, -1)
                mask = cv2.bitwise_and(thresh, thresh, mask=mask)
                pixels.append(cv2.countNonZero(mask))

            # Find the most filled bubble
            best_idx = np.argmax(pixels)
            
            # Map index to digit (0-9)
            if len(col_bubbles) == 10:
                digit = best_idx  # Direct mapping: 0-9
            else:
                # If column doesn't have exactly 10 bubbles, still use index
                digit = best_idx % 10
            
            detected_roll += str(digit)

            # Draw green rectangle around detected bubble
            (bx, by, bw, bh) = cv2.boundingRect(col_bubbles[best_idx])
            cv2.rectangle(warped_color, (bx, by), (bx + bw, by + bh), (0, 255, 0), 2)
    
    # Debug: Print final detected roll number
    print(f"DEBUG: Final detected roll number: '{detected_roll}'")

    # ==========================================
    # 2. ANSWER KEY DETECTION (from clustered bubbles)
    # ==========================================
    detected_answers = {}
    section_configs = [
        {"name": "Left", "bubbles": sections["left_answers"], "start_q": 1},
        {"name": "Right", "bubbles": sections["right_answers"], "start_q": 6},
    ]

    for section in section_configs:
        bubbles = section["bubbles"]

        if len(bubbles) > 0:
            bubbles = imutils_contours.sort_contours(bubbles, method="top-to-bottom")[0]
            rows = []
            current_row = [bubbles[0]]
            for c in bubbles[1:]:
                (_, by, _, _) = cv2.boundingRect(c)
                (_, last_y, _, _) = cv2.boundingRect(current_row[-1])
                if abs(by - last_y) < 20:
                    current_row.append(c)
                else:
                    rows.append(current_row)
                    current_row = [c]
            rows.append(current_row)

            q_idx = section["start_q"]
            for row in rows:
                row = imutils_contours.sort_contours(row, method="left-to-right")[0]
                if len(row) > 4:
                    row = sorted(row, key=cv2.contourArea, reverse=True)[:4]
                if len(row) < 4:
                    q_idx += 1
                    continue

                row = imutils_contours.sort_contours(row, method="left-to-right")[0]

                pixels = []
                for c in row:
                    mask = np.zeros(thresh.shape, dtype="uint8")
                    cv2.drawContours(mask, [c], -1, 255, -1)
                    mask = cv2.bitwise_and(thresh, thresh, mask=mask)
                    pixels.append(cv2.countNonZero(mask))

                best_idx = np.argmax(pixels)
                detected_char = OPTIONS[best_idx]
                detected_answers[q_idx] = detected_char

                c_marked = row[best_idx]
                (bx, by, bw, bh) = cv2.boundingRect(c_marked)
                color = (
                    (0, 255, 0)
                    if detected_char == ANSWER_KEY.get(q_idx)
                    else (0, 0, 255)
                )
                cv2.rectangle(warped_color, (bx, by), (bx + bw, by + bh), color, 2)
                q_idx += 1

    # --- SCORING ---
    score = 0
    results = []
    for q in range(1, 11):
        student_ans = detected_answers.get(q, "-")
        correct_ans = ANSWER_KEY.get(q, "?")
        is_correct = student_ans == correct_ans
        if is_correct:
            score += 1
        results.append(
            {
                "question": q,
                "student_answer": student_ans.upper(),
                "correct_answer": correct_ans.upper(),
                "is_correct": is_correct,
            }
        )

    # Convert processed image to base64
    _, buffer = cv2.imencode(".jpg", warped_color)
    processed_image_b64 = base64.b64encode(buffer).decode("utf-8")

    return {
        "roll_number": detected_roll,
        "score": score,
        "total": 10,
        "results": results,
        "processed_image": processed_image_b64,
    }


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/upload", methods=["POST"])
def upload():
    try:
        image = None

        if "image" in request.files:
            # File upload
            file = request.files["image"]
            if file.filename == "":
                return jsonify({"error": "No file selected"}), 400

            # Read image from file
            file_bytes = np.frombuffer(file.read(), np.uint8)
            image = cv2.imdecode(file_bytes, cv2.IMREAD_COLOR)

        elif request.is_json:
            data = request.get_json()
            if data and "image" in data:
                # Base64 image from camera capture
                image_data = data["image"]
                # Remove data URL prefix if present
                if "," in image_data:
                    image_data = image_data.split(",")[1]

                # Decode base64
                image_bytes = base64.b64decode(image_data)
                image_array = np.frombuffer(image_bytes, np.uint8)
                image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)

        elif request.data:
            # Try to parse as JSON manually
            try:
                import json

                data = json.loads(request.data)
                if "image" in data:
                    image_data = data["image"]
                    if "," in image_data:
                        image_data = image_data.split(",")[1]
                    image_bytes = base64.b64decode(image_data)
                    image_array = np.frombuffer(image_bytes, np.uint8)
                    image = cv2.imdecode(image_array, cv2.IMREAD_COLOR)
            except Exception:
                pass

        if image is None:
            return jsonify(
                {"error": "No image provided or could not decode image"}
            ), 400

        # Process the OMR image
        result = process_omr_image(image)

        # Save the original image for records
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        filename = f"omr_{result['roll_number']}_{timestamp}.jpg"
        cv2.imwrite(os.path.join(UPLOAD_FOLDER, filename), image)

        return jsonify(result)

    except Exception as e:
        import traceback

        print(f"Error: {str(e)}")
        print(traceback.format_exc())
        return jsonify({"error": str(e)}), 500


@app.route("/answer-key", methods=["GET", "POST"])
def answer_key():
    global ANSWER_KEY
    if request.method == "POST":
        data = request.json
        if "answer_key" in data:
            new_key = {}
            for q, ans in data["answer_key"].items():
                new_key[int(q)] = ans.lower()
            ANSWER_KEY = new_key
            return jsonify({"message": "Answer key updated", "answer_key": ANSWER_KEY})
    return jsonify({"answer_key": ANSWER_KEY})


if __name__ == "__main__":
    # Run on all interfaces so phone can access via IP
    app.run(host="0.0.0.0", port=5000, debug=True)
