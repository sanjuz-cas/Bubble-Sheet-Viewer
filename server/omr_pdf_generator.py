#!/usr/bin/env python3
"""
BubbleScan OMR PDF Dossier Generator
Generates institutional-grade, publication-quality PDF reports:
1. Multi-Page Class Master Dossier:
   - Page 1: Executive Analytics, KPI Cards, Grade Histogram/Table, Rankings Leaderboard
   - Pages 2..N+1: Dedicated 1-Page-per-OMR Student Dossiers with Annotated Visual Sheet & Score Table
2. Single Student Scorecard PDF Certificate
"""

import os
import sys
import io
import json
import base64
import tempfile
from datetime import datetime

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, Image as RLImage, PageBreak, KeepTogether, HRFlowable
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT, TA_JUSTIFY

PAGE_W, PAGE_H = A4

# Custom Palette
PRIMARY_DARK = colors.HexColor("#1E1B2E")
PRIMARY_ACCENT = colors.HexColor("#4F46E5")
SECONDARY_TEAL = colors.HexColor("#06B6D4")
BG_LIGHT = colors.HexColor("#F8FAFC")
BORDER_COLOR = colors.HexColor("#E2E8F0")
TEXT_MAIN = colors.HexColor("#0F172A")
TEXT_MUTED = colors.HexColor("#64748B")

COLOR_CORRECT = colors.HexColor("#10B981")
COLOR_PARTIAL = colors.HexColor("#0284C7")
COLOR_WRONG = colors.HexColor("#EF4444")
COLOR_BLANK = colors.HexColor("#F59E0B")


def get_grade_color(grade):
    if grade in ["A+", "A"]:
        return colors.HexColor("#10B981")
    elif grade in ["B+", "B"]:
        return colors.HexColor("#3B82F6")
    elif grade in ["C+", "C"]:
        return colors.HexColor("#8B5CF6")
    elif grade == "D":
        return colors.HexColor("#F59E0B")
    return colors.HexColor("#EF4444")


def format_mark(val):
    try:
        f = float(val)
        if f.is_integer():
            return str(int(f))
        return f"{f:.3f}".rstrip("0").rstrip(".")
    except:
        return str(val)


def generate_dossier_pdf(data, output_path):
    """
    Generate the complete multi-page PDF document.
    """
    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=24,
        rightMargin=24,
        topMargin=24,
        bottomMargin=24
    )

    styles = getSampleStyleSheet()
    
    # Custom Typography Styles
    title_style = ParagraphStyle(
        'DocTitle',
        fontName='Helvetica-Bold',
        fontSize=20,
        leading=24,
        textColor=PRIMARY_DARK,
        alignment=TA_LEFT
    )
    subtitle_style = ParagraphStyle(
        'DocSubTitle',
        fontName='Helvetica',
        fontSize=10,
        leading=13,
        textColor=TEXT_MUTED,
        alignment=TA_LEFT
    )
    section_hdr = ParagraphStyle(
        'SectionHeader',
        fontName='Helvetica-Bold',
        fontSize=13,
        leading=16,
        textColor=PRIMARY_DARK,
        spaceAfter=6
    )
    kpi_num = ParagraphStyle(
        'KpiNum',
        fontName='Helvetica-Bold',
        fontSize=16,
        leading=19,
        textColor=PRIMARY_ACCENT,
        alignment=TA_CENTER
    )
    kpi_lbl = ParagraphStyle(
        'KpiLbl',
        fontName='Helvetica',
        fontSize=8,
        leading=10,
        textColor=TEXT_MUTED,
        alignment=TA_CENTER
    )
    table_hdr = ParagraphStyle(
        'TblHdr',
        fontName='Helvetica-Bold',
        fontSize=8,
        leading=10,
        textColor=colors.white,
        alignment=TA_CENTER
    )
    table_body = ParagraphStyle(
        'TblBody',
        fontName='Helvetica',
        fontSize=8,
        leading=10,
        textColor=TEXT_MAIN,
        alignment=TA_CENTER
    )
    table_left = ParagraphStyle(
        'TblLeft',
        fontName='Helvetica',
        fontSize=8,
        leading=10,
        textColor=TEXT_MAIN,
        alignment=TA_LEFT
    )

    story = []

    exam_name = data.get("examName", "Assessment Examination")
    subject = data.get("subject", "General Subject")
    total_marks_exam = float(data.get("totalMarks", 30.0))
    results = data.get("results", [])

    temp_files_to_cleanup = []

    # Sort results by numeric roll number
    def roll_sort_key(r):
        roll_str = str(r.get("detectedRollNumber", "")).strip()
        try:
            return (0, int(roll_str))
        except:
            return (1, roll_str)

    sorted_results = sorted(results, key=roll_sort_key)
    total_students = len(sorted_results)

    # =========================================================================
    # PAGE 1: EXECUTIVE CLASS PERFORMANCE & LEADERBOARD (if multi-result)
    # =========================================================================
    if total_students > 1:
        # Header Banner
        hdr_table_data = [
            [
                Paragraph(f"<b>BUBBLESCAN OMR MASTER DOSSIER</b><br/><font size=10 color='#64748B'>{exam_name} &bull; {subject}</font>", title_style),
                Paragraph(f"<font size=8 color='#64748B'>Generated: {datetime.now().strftime('%b %d, %Y %I:%M %p')}<br/>Total Candidates: <b>{total_students}</b></font>", subtitle_style)
            ]
        ]
        hdr_tbl = Table(hdr_table_data, colWidths=[360, 185])
        hdr_tbl.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        story.append(hdr_tbl)
        story.append(Spacer(1, 8))
        story.append(HRFlowable(width="100%", thickness=1.5, color=PRIMARY_ACCENT, spaceBefore=0, spaceAfter=10))

        # Metrics calculation
        scores = [float(r.get("score", 0)) for r in sorted_results]
        percentages = [float(r.get("percentage", 0)) for r in sorted_results]
        avg_score = sum(scores) / max(total_students, 1)
        avg_pct = sum(percentages) / max(total_students, 1)
        max_score = max(scores) if scores else 0
        min_score = min(scores) if scores else 0
        passed_count = sum(1 for p in percentages if p >= 45.0)
        pass_rate = (passed_count / max(total_students, 1)) * 100.0

        # KPI Cards (4 columns)
        kpi_data = [
            [
                Paragraph(f"{avg_score:.1f} / {total_marks_exam:.0f}", kpi_num),
                Paragraph(f"{max_score:.1f} / {total_marks_exam:.0f}", kpi_num),
                Paragraph(f"{pass_rate:.1f}%", kpi_num),
                Paragraph(f"{total_students}", kpi_num),
            ],
            [
                Paragraph("CLASS AVERAGE", kpi_lbl),
                Paragraph("HIGHEST SCORE", kpi_lbl),
                Paragraph("PASSING RATE", kpi_lbl),
                Paragraph("EVALUATED SHEETS", kpi_lbl),
            ]
        ]
        kpi_tbl = Table(kpi_data, colWidths=[135, 135, 135, 140])
        kpi_tbl.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), BG_LIGHT),
            ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ]))
        story.append(kpi_tbl)
        story.append(Spacer(1, 14))

        # Grade Distribution Breakdown
        story.append(Paragraph("Grade Distribution & Statistics", section_hdr))
        
        grades_list = ["A+", "A", "B+", "B", "C+", "C", "D", "F"]
        grade_counts = {g: 0 for g in grades_list}
        for r in sorted_results:
            g = r.get("grade", "F")
            grade_counts[g] = grade_counts.get(g, 0) + 1

        dist_hdr = [Paragraph(f"<b>{g}</b>", table_hdr) for g in grades_list]
        dist_cnt = [Paragraph(f"<b>{grade_counts[g]}</b>", table_body) for g in grades_list]
        dist_pct = [Paragraph(f"{(grade_counts[g]/max(total_students,1))*100:.1f}%", subtitle_style) for g in grades_list]

        dist_tbl = Table([dist_hdr, dist_cnt, dist_pct], colWidths=[68]*8)
        dist_tbl.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), PRIMARY_DARK),
            ('BACKGROUND', (0, 1), (-1, 1), colors.white),
            ('BACKGROUND', (0, 2), (-1, 2), BG_LIGHT),
            ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        story.append(dist_tbl)
        story.append(Spacer(1, 14))

        # Roll-Wise Candidate Ledger Table
        story.append(Paragraph("Candidate Roster & Rank Order", section_hdr))
        
        roster_headers = [
            Paragraph("<b>Rank</b>", table_hdr),
            Paragraph("<b>Roll No</b>", table_hdr),
            Paragraph("<b>Set</b>", table_hdr),
            Paragraph("<b>Score</b>", table_hdr),
            Paragraph("<b>Max</b>", table_hdr),
            Paragraph("<b>Percentage</b>", table_hdr),
            Paragraph("<b>Grade</b>", table_hdr),
            Paragraph("<b>Status</b>", table_hdr),
        ]
        roster_rows = [roster_headers]

        # Calculate ranks
        ranked_list = sorted(sorted_results, key=lambda x: float(x.get("score", 0)), reverse=True)
        rank_map = {r.get("id"): idx + 1 for idx, r in enumerate(ranked_list)}

        for idx, item in enumerate(sorted_results):
            score_val = float(item.get("score", 0))
            pct_val = float(item.get("percentage", 0))
            grade_val = item.get("grade", "F")
            rank_val = rank_map.get(item.get("id"), idx + 1)
            pass_status = "<font color='#10B981'><b>PASSED</b></font>" if pct_val >= 45.0 else "<font color='#EF4444'><b>NEEDS ATTN</b></font>"
            
            row = [
                Paragraph(f"#{rank_val}", table_body),
                Paragraph(f"<b>{item.get('detectedRollNumber', 'N/A')}</b>", table_body),
                Paragraph(f"{item.get('detectedSet', 'N/A')}", table_body),
                Paragraph(f"<b>{format_mark(score_val)}</b>", table_body),
                Paragraph(f"{format_mark(item.get('totalMarks', total_marks_exam))}", table_body),
                Paragraph(f"{pct_val:.1f}%", table_body),
                Paragraph(f"<b>{grade_val}</b>", table_body),
                Paragraph(pass_status, table_body),
            ]
            roster_rows.append(row)

        roster_tbl = Table(roster_rows, colWidths=[40, 95, 65, 65, 55, 75, 55, 95])
        roster_tbl.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), PRIMARY_ACCENT),
            ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, BG_LIGHT]),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('TOPPADDING', (0, 0), (-1, -1), 3),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
        ]))
        story.append(roster_tbl)
        story.append(PageBreak())

    # =========================================================================
    # INDIVIDUAL OMR SHEET DOSSIERS: 1 PAGE PER SHEET
    # =========================================================================
    ranked_list = sorted(sorted_results, key=lambda x: float(x.get("score", 0)), reverse=True)
    rank_map = {r.get("id"): idx + 1 for idx, r in enumerate(ranked_list)}

    for s_idx, student in enumerate(sorted_results):
        roll_no = str(student.get("detectedRollNumber", "N/A")).strip()
        set_name = str(student.get("detectedSet", "N/A")).strip()
        score_val = float(student.get("score", 0))
        tot_m = float(student.get("totalMarks", total_marks_exam))
        pct_val = float(student.get("percentage", 0))
        grade_val = student.get("grade", "F")
        rank_val = rank_map.get(student.get("id"), s_idx + 1)
        q_results = student.get("questionResults", [])
        scanned_at_str = student.get("scannedAt", datetime.now().isoformat())
        
        try:
            date_fmt = datetime.fromisoformat(scanned_at_str.replace("Z", "+00:00")).strftime("%d %b %Y, %I:%M %p")
        except:
            date_fmt = str(scanned_at_str)

        # Header Block
        st_hdr = [
            [
                Paragraph(f"<b>ROLL NO: {roll_no}</b> &nbsp;&bull;&nbsp; <font color='#4F46E5'><b>{set_name}</b></font><br/><font size=9 color='#64748B'>{exam_name} &bull; {subject}</font>", title_style),
                Paragraph(
                    f"<table width='100%'><tr>"
                    f"<td align='right'><b>SCORE:</b> <font size=12 color='#10B981'><b>{format_mark(score_val)} / {format_mark(tot_m)}</b></font></td>"
                    f"<td align='right' width='60'><b>GRADE:</b> <font size=12 color='#4F46E5'><b>{grade_val}</b></font></td>"
                    f"<td align='right' width='50'><b>RANK:</b> #{rank_val}</td>"
                    f"</tr></table>",
                    table_left
                )
            ]
        ]
        st_hdr_tbl = Table(st_hdr, colWidths=[260, 285])
        st_hdr_tbl.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
        ]))
        story.append(st_hdr_tbl)
        story.append(Spacer(1, 4))
        story.append(HRFlowable(width="100%", thickness=1, color=PRIMARY_ACCENT, spaceBefore=0, spaceAfter=8))

        # Main Body: 2 Columns (Left: Annotated Image, Right: Questions Score Table)
        # Left Image Handling
        img_flowable = None
        annotated_b64 = student.get("annotatedImage")
        raw_img_uri = student.get("imageUri")

        target_img_bytes = None
        if annotated_b64 and "," in annotated_b64:
            try:
                target_img_bytes = base64.b64decode(annotated_b64.split(",")[1])
            except Exception as e:
                print(f"Error decoding b64 image: {e}", file=sys.stderr)
        elif raw_img_uri and os.path.exists(raw_img_uri):
            try:
                with open(raw_img_uri, "rb") as f:
                    target_img_bytes = f.read()
            except Exception as e:
                print(f"Error reading imageUri: {e}", file=sys.stderr)

        if target_img_bytes:
            tfile = tempfile.NamedTemporaryFile(suffix=".jpg", delete=False)
            tfile.write(target_img_bytes)
            tfile.close()
            temp_files_to_cleanup.append(tfile.name)
            # A4 page width = 595. Margins = 48 total. Printable width = 547.
            # Left column width = 235, height = 330
            img_flowable = RLImage(tfile.name, width=235, height=330)
        else:
            # Fallback placeholder
            img_flowable = Paragraph("<br/><br/><br/><i>[Visual OMR Sheet Preview]</i>", table_body)

        # Right Question Table
        q_tbl_headers = [
            Paragraph("<b>Q#</b>", table_hdr),
            Paragraph("<b>Marked</b>", table_hdr),
            Paragraph("<b>Key</b>", table_hdr),
            Paragraph("<b>Mark</b>", table_hdr),
            Paragraph("<b>Status</b>", table_hdr),
        ]
        q_rows = [q_tbl_headers]

        for q in q_results:
            q_num = q.get("questionNumber", 1)
            selected_str = "+".join(q.get("selected", [])) if isinstance(q.get("selected"), list) else str(q.get("selected", ""))
            correct_str = "+".join(q.get("correct", [])) if isinstance(q.get("correct"), list) else str(q.get("correct", ""))
            q_mark = float(q.get("mark", 0))
            is_corr = q.get("isCorrect", False)
            
            if not selected_str:
                status_txt = "<font color='#F59E0B'><b>BLANK</b></font>"
            elif is_corr:
                status_txt = "<font color='#10B981'><b>CORRECT</b></font>"
            elif q_mark > 0:
                status_txt = "<font color='#0284C7'><b>PARTIAL</b></font>"
            else:
                status_txt = "<font color='#EF4444'><b>WRONG</b></font>"

            q_rows.append([
                Paragraph(f"Q{q_num}", table_body),
                Paragraph(f"<b>{selected_str if selected_str else '—'}</b>", table_body),
                Paragraph(f"{correct_str if correct_str else '—'}", table_body),
                Paragraph(f"<b>{format_mark(q_mark)}</b>", table_body),
                Paragraph(status_txt, table_body),
            ])

        q_table = Table(q_rows, colWidths=[28, 75, 75, 45, 67])
        q_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), PRIMARY_DARK),
            ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
            ('INNERGRID', (0, 0), (-1, -1), 0.5, BORDER_COLOR),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, BG_LIGHT]),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 2.5),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 2.5),
        ]))

        # Dual Column Layout
        main_dual_table = Table([[img_flowable, q_table]], colWidths=[245, 300])
        main_dual_table.setStyle(TableStyle([
            ('VALIGN', (0, 0), (-1, -1), 'TOP'),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('LEFTPADDING', (0, 0), (-1, -1), 0),
            ('RIGHTPADDING', (0, 0), (-1, -1), 0),
            ('TOPPADDING', (0, 0), (-1, -1), 0),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
        ]))
        story.append(main_dual_table)
        story.append(Spacer(1, 10))

        # Bottom Verification and Signature Footer
        corr_cnt = sum(1 for q in q_results if q.get("isCorrect"))
        part_cnt = sum(1 for q in q_results if not q.get("isCorrect") and float(q.get("mark", 0)) > 0)
        wrong_cnt = sum(1 for q in q_results if float(q.get("mark", 0)) == 0 and q.get("selected"))
        blank_cnt = sum(1 for q in q_results if not q.get("selected"))

        summary_footer = [
            [
                Paragraph(
                    f"<b>Summary:</b> Correct: <font color='#10B981'><b>{corr_cnt}</b></font> &nbsp;|&nbsp; "
                    f"Partial: <font color='#0284C7'><b>{part_cnt}</b></font> &nbsp;|&nbsp; "
                    f"Wrong: <font color='#EF4444'><b>{wrong_cnt}</b></font> &nbsp;|&nbsp; "
                    f"Blank: <font color='#F59E0B'><b>{blank_cnt}</b></font><br/>"
                    f"<font size=7 color='#64748B'>Scanned & Evaluated on: {date_fmt}</font>",
                    subtitle_style
                ),
                Paragraph(
                    "<b>Evaluator Signature:</b> ___________________<br/>"
                    "<font size=7 color='#64748B'>Verified with BubbleScan Universal OMR Engine</font>",
                    table_left
                )
            ]
        ]
        ft_tbl = Table(summary_footer, colWidths=[330, 215])
        ft_tbl.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, -1), BG_LIGHT),
            ('BOX', (0, 0), (-1, -1), 1, BORDER_COLOR),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ]))
        story.append(ft_tbl)

        # If not the last student, add page break for 1-sheet-per-page
        if s_idx < total_students - 1:
            story.append(PageBreak())

    # Build PDF
    try:
        doc.build(story)
    finally:
        for tf in temp_files_to_cleanup:
            try:
                os.remove(tf)
            except:
                pass


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: omr_pdf_generator.py <input_json_path_or_data> <output_pdf_path>")
        sys.exit(1)

    in_arg = sys.argv[1]
    out_pdf = sys.argv[2]

    try:
        if os.path.exists(in_arg):
            with open(in_arg, "r", encoding="utf-8") as f:
                json_data = json.load(f)
        else:
            json_data = json.loads(in_arg)

        generate_dossier_pdf(json_data, out_pdf)
        print(f"SUCCESS: PDF generated at {out_pdf}")
    except Exception as exc:
        import traceback
        print(json.dumps({"error": str(exc), "trace": traceback.format_exc()}))
        sys.exit(1)
