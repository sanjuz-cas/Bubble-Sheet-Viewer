"""
BubbleScan AI™ — High-Performance PDF Multi-Page Unpacker
Extracts each page of a single or multi-page PDF document into high-resolution images.
Supports 1 to 500+ pages per PDF.
"""

import sys
import os
import json
import base64
import fitz  # PyMuPDF


def unpack_pdf_to_images(pdf_input, dpi=180, quality=85):
    """
    Renders every page in the PDF to a JPEG base64 dataUrl.
    pdf_input: file path or base64 data string
    """
    if isinstance(pdf_input, str) and pdf_input.startswith("data:application/pdf;base64,"):
        raw_b64 = pdf_input.split(",", 1)[1]
        pdf_bytes = base64.b64decode(raw_b64)
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    elif isinstance(pdf_input, str) and os.path.exists(pdf_input):
        doc = fitz.open(pdf_input)
    elif isinstance(pdf_input, bytes):
        doc = fitz.open(stream=pdf_input, filetype="pdf")
    else:
        # Try raw base64 decode
        try:
            pdf_bytes = base64.b64decode(pdf_input)
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        except Exception as e:
            raise ValueError(f"Invalid PDF input: {e}")

    total_pages = len(doc)
    pages_output = []

    for page_idx in range(total_pages):
        page = doc[page_idx]
        pix = page.get_pixmap(dpi=dpi)
        
        # Convert pixmap to JPEG bytes
        img_bytes = pix.tobytes("jpeg")
        b64_str = "data:image/jpeg;base64," + base64.b64encode(img_bytes).decode("utf-8")

        pages_output.append({
            "pageNumber": page_idx + 1,
            "totalPages": total_pages,
            "width": pix.width,
            "height": pix.height,
            "dataUrl": b64_str
        })

    doc.close()

    return {
        "success": True,
        "totalPages": total_pages,
        "pages": pages_output
    }


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Usage: pdf_unpacker.py <pdf_path_or_json_file>"}))
        sys.exit(1)

    input_arg = sys.argv[1]
    
    try:
        if input_arg.endswith(".json") and os.path.exists(input_arg):
            with open(input_arg, "r", encoding="utf-8") as f:
                data = json.load(f)
            pdf_data = data.get("pdf")
            dpi = data.get("dpi", 180)
            res = unpack_pdf_to_images(pdf_data, dpi=dpi)
        else:
            res = unpack_pdf_to_images(input_arg, dpi=180)
            
        print(json.dumps(res))
    except Exception as e:
        print(json.dumps({"error": str(e), "success": False}), file=sys.stderr)
        sys.exit(1)
