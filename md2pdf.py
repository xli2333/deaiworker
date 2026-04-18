#!/usr/bin/env python3
"""
Markdown to PDF converter with professional Chinese typesetting.
Uses fpdf2 for pure-Python conversion on Windows.
Supports: headings, paragraphs (with 2em indent), tables (multi-line cells),
          ordered/unordered lists, page header/footer.
"""

import sys
import os
import re
from fpdf import FPDF

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
WINDOWS_FONT_DIR = os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts")
LINUX_FONT_DIRS = (
    "/usr/share/fonts/opentype/noto",
    "/usr/share/fonts/truetype/wqy",
    "/usr/share/fonts/truetype/noto",
)

# Page geometry (mm)
PAGE_W = 210
PAGE_H = 297
MARGIN_L = 25
MARGIN_R = 25
MARGIN_T = 28
MARGIN_B = 25
CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R

# Font sizes (pt)
TITLE_SIZE = 18
H2_SIZE = 13
H3_SIZE = 11.5
BODY_SIZE = 10.5
TABLE_HEADER_SIZE = 8.5
TABLE_BODY_SIZE = 8.5
FOOTER_SIZE = 7.5

# Line heights (mm)
BODY_LH = 6.8          # generous line height for CJK readability
TABLE_CELL_PAD = 2.8   # vertical padding inside table cells

# Colors
COLOR_TITLE = (13, 27, 42)
COLOR_H2 = (27, 58, 92)
COLOR_H2_BAR = (42, 100, 150)
COLOR_BODY = (34, 34, 34)
COLOR_TABLE_HEAD_BG = (27, 58, 92)
COLOR_TABLE_HEAD_TEXT = (255, 255, 255)
COLOR_TABLE_BORDER = (200, 210, 220)
COLOR_TABLE_STRIPE = (245, 247, 250)
COLOR_TABLE_FIRST_COL = (27, 58, 92)
COLOR_FOOTER = (160, 160, 160)
COLOR_TITLE_LINE = (42, 100, 150)
COLOR_LIST_NUM = (27, 58, 92)


def _first_existing_path(candidates):
    for candidate in candidates:
        if candidate and os.path.exists(candidate):
            return candidate
    return None


def _resolve_font_path(role, windows_name, linux_names):
    env_key = f"MD2PDF_FONT_{role.upper()}"
    env_path = os.environ.get(env_key)
    candidates = [env_path, os.path.join(WINDOWS_FONT_DIR, windows_name)]
    for font_dir in LINUX_FONT_DIRS:
        for linux_name in linux_names:
            candidates.append(os.path.join(font_dir, linux_name))
    resolved = _first_existing_path(candidates)
    if resolved:
        return resolved
    raise FileNotFoundError(
        f"Unable to find a usable font for {role}. "
        f"Set {env_key} or install a CJK font such as fonts-noto-cjk."
    )


# ---------------------------------------------------------------------------
# PDF class
# ---------------------------------------------------------------------------
class MdPdf(FPDF):

    def __init__(self):
        super().__init__(orientation="P", unit="mm", format="A4")
        self.set_margins(MARGIN_L, MARGIN_T, MARGIN_R)
        self.set_auto_page_break(auto=True, margin=MARGIN_B)
        self._load_fonts()
        self.doc_title = ""

    def _load_fonts(self):
        regular_font = _resolve_font_path(
            "regular",
            "msyh.ttc",
            ("NotoSansCJK-Regular.ttc", "NotoSerifCJK-Regular.ttc", "wqy-zenhei.ttc"),
        )
        bold_font = _resolve_font_path(
            "bold",
            "msyhbd.ttc",
            ("NotoSansCJK-Bold.ttc", "NotoSerifCJK-Bold.ttc", "wqy-zenhei.ttc"),
        )
        heading_font = _first_existing_path(
            [
                os.environ.get("MD2PDF_FONT_HEADING"),
                os.path.join(WINDOWS_FONT_DIR, "simhei.ttf"),
                bold_font,
            ]
        )

        self.add_font("msyh", "", regular_font)
        self.add_font("msyh", "B", bold_font)
        self.add_font("simhei", "", heading_font or bold_font)

    def header(self):
        if self.page_no() == 1:
            return
        self.set_font("msyh", "", FOOTER_SIZE)
        self.set_text_color(*COLOR_FOOTER)
        self.set_y(12)
        self.cell(CONTENT_W, 4, self.doc_title, align="C",
                  new_x="LMARGIN", new_y="NEXT")
        self.set_draw_color(*COLOR_TABLE_BORDER)
        self.set_line_width(0.3)
        self.line(MARGIN_L, 17.5, PAGE_W - MARGIN_R, 17.5)
        self.set_y(MARGIN_T)

    def footer(self):
        self.set_y(-15)
        self.set_draw_color(*COLOR_TABLE_BORDER)
        self.set_line_width(0.3)
        self.line(MARGIN_L, PAGE_H - 17, PAGE_W - MARGIN_R, PAGE_H - 17)
        self.set_font("msyh", "", FOOTER_SIZE)
        self.set_text_color(*COLOR_FOOTER)
        self.cell(CONTENT_W, 4, f"{self.page_no()} / {{nb}}", align="C")


# ---------------------------------------------------------------------------
# Markdown parser
# ---------------------------------------------------------------------------
def parse_md(md_text):
    """Parse markdown into block elements."""
    blocks = []
    lines = md_text.split("\n")
    i = 0

    while i < len(lines):
        line = lines[i]

        # Headings (check ### before ## before #)
        if line.startswith("### "):
            blocks.append(("h3", line[4:].strip()))
            i += 1; continue
        if line.startswith("## "):
            blocks.append(("h2", line[3:].strip()))
            i += 1; continue
        if line.startswith("# "):
            blocks.append(("h1", line[2:].strip()))
            i += 1; continue

        # Table
        if (line.strip().startswith("|")
                and i + 1 < len(lines)
                and "---" in lines[i + 1]):
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i])
                i += 1
            headers = [c.strip() for c in table_lines[0].strip().strip("|").split("|")]
            rows = []
            for tl in table_lines[2:]:
                row = [c.strip() for c in tl.strip().strip("|").split("|")]
                rows.append(row)
            blocks.append(("table", headers, rows))
            continue

        # Ordered list
        if re.match(r"^\d+\.\s", line.strip()):
            items = []
            while i < len(lines) and re.match(r"^\d+\.\s", lines[i].strip()):
                items.append(re.sub(r"^\d+\.\s*", "", lines[i].strip()))
                i += 1
            blocks.append(("ol", items))
            continue

        # Unordered list
        if line.strip().startswith("- ") or line.strip().startswith("* "):
            items = []
            while i < len(lines) and (lines[i].strip().startswith("- ")
                                      or lines[i].strip().startswith("* ")):
                items.append(lines[i].strip()[2:])
                i += 1
            blocks.append(("ul", items))
            continue

        # Blank
        if line.strip() == "":
            i += 1; continue

        # Paragraph
        para_lines = []
        while i < len(lines):
            ln = lines[i]
            if ln.strip() == "":
                i += 1; break
            if (ln.startswith("#") or ln.strip().startswith("|")
                    or re.match(r"^\d+\.\s", ln.strip())
                    or ln.strip().startswith("- ")
                    or ln.strip().startswith("* ")):
                break
            para_lines.append(ln.strip())
            i += 1
        if para_lines:
            blocks.append(("p", " ".join(para_lines)))

    return blocks


def strip_md(text):
    """Remove inline markdown formatting."""
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"\*(.+?)\*", r"\1", text)
    text = re.sub(r"`(.+?)`", r"\1", text)
    return text


def _normalize_text(text):
    """Normalize text without introducing character substitutions."""
    text = str(text).replace("\u00a0", " ")
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text


# ---------------------------------------------------------------------------
# Smart line-breaking for mixed CJK/English text
# ---------------------------------------------------------------------------
def _tokenize_mixed(text):
    """Split text into tokens for smart line-breaking.
    Returns list of (token_str, can_break_before) tuples.
    Tokens are: English words (letters+digits as one unit), CJK chars (individual),
    punctuation, spaces.
    English words and adjacent parenthesized phrases are kept as single tokens
    so they won't be split mid-word.
    """
    tokens = []
    i = 0
    while i < len(text):
        ch = text[i]

        # ASCII word (letters, digits, and embedded punctuation like hyphens/dots)
        if ch.isascii() and (ch.isalpha() or ch.isdigit()):
            j = i
            while j < len(text) and text[j].isascii() and (
                    text[j].isalpha() or text[j].isdigit()
                    or text[j] in ".-_"):
                j += 1
            word = text[i:j]
            # Can break before an English word if preceded by CJK
            can_break = (len(tokens) > 0)
            tokens.append((word, can_break))
            i = j
            continue

        # Space — break opportunity, but don't emit the space as visible width
        # unless between two English tokens
        if ch == " ":
            # Look back and ahead to decide if space is between English words
            if (tokens and tokens[-1][0][-1:].isascii()
                    and tokens[-1][0][-1:].isalnum()
                    and i + 1 < len(text) and text[i + 1].isascii()
                    and text[i + 1].isalnum()):
                # Space between English words — include it with next token
                # to keep "Capital Markets" as a unit in parenthesized context
                # Check if we're inside parentheses
                # Simple approach: just include the space as part of token flow
                tokens.append((" ", True))
            else:
                # Space between CJK and English or other — break opportunity
                tokens.append((" ", True))
            i += 1
            continue

        # CJK character — each is a break opportunity
        if ord(ch) > 0x2E80:
            can_break = (len(tokens) > 0)
            tokens.append((ch, can_break))
            i += 1
            continue

        # Other (punctuation, etc.)
        tokens.append((ch, False))  # Don't break before punctuation
        i += 1

    return tokens


def _smart_wrap(pdf, text, max_width):
    """Word-wrap mixed CJK/English text respecting word boundaries.
    Returns list of line strings.
    """
    tokens = _tokenize_mixed(text)
    lines = []
    current_line = ""
    current_width = 0.0

    for tok, can_break in tokens:
        tok_width = pdf.get_string_width(tok)

        # Would this token overflow?
        if current_width + tok_width > max_width and current_line:
            if can_break:
                # Break here — start new line with this token
                lines.append(current_line)
                current_line = tok.lstrip()  # strip leading space on new line
                current_width = pdf.get_string_width(current_line)
            else:
                # Can't break here (e.g. punctuation) — add to current line
                current_line += tok
                current_width += tok_width
        else:
            current_line += tok
            current_width += tok_width

    if current_line:
        lines.append(current_line)

    return lines if lines else [""]


def _write_paragraph(pdf, text, x, width, line_height):
    """Write a paragraph using smart line-breaking."""
    lines = _smart_wrap(pdf, text, width)
    first = True
    for line in lines:
        if first:
            pdf.set_x(x)
            first = False
        else:
            pdf.set_x(x - 2 * BODY_SIZE * 0.352)  # no indent on continuation
        # Check page break
        if pdf.get_y() + line_height > PAGE_H - MARGIN_B:
            pdf.add_page()
            pdf.set_x(x - 2 * BODY_SIZE * 0.352)
        pdf.cell(width, line_height, line, new_x="LMARGIN", new_y="NEXT")


def _write_text_block(pdf, text, x, width, line_height):
    """Write a text block (no first-line indent difference) using smart wrapping."""
    lines = _smart_wrap(pdf, text, width)
    for line in lines:
        if pdf.get_y() + line_height > PAGE_H - MARGIN_B:
            pdf.add_page()
        pdf.set_x(x)
        pdf.cell(width, line_height, line, new_x="LMARGIN", new_y="NEXT")


# ---------------------------------------------------------------------------
# Table helpers  — multi-line cell support
# ---------------------------------------------------------------------------
def _calc_col_widths(pdf, headers, rows, n_cols):
    """Calculate column widths with intelligent distribution."""
    # Measure max content width per column
    max_w = [0.0] * n_cols
    pdf.set_font("msyh", "B", TABLE_HEADER_SIZE)
    for j, h in enumerate(headers):
        max_w[j] = max(max_w[j], pdf.get_string_width(strip_md(h)))
    pdf.set_font("msyh", "", TABLE_BODY_SIZE)
    for row in rows:
        for j in range(min(len(row), n_cols)):
            max_w[j] = max(max_w[j], pdf.get_string_width(strip_md(row[j])))

    # Add padding
    max_w = [w + 6 for w in max_w]

    total_natural = sum(max_w)

    if total_natural <= CONTENT_W:
        # Everything fits — distribute remaining space proportionally
        extra = CONTENT_W - total_natural
        return [w + extra * (w / total_natural) for w in max_w]

    # Doesn't fit: distribute proportionally but with minimum widths
    # First column (labels) gets extra space for readability
    min_col = 30
    widths = list(max_w)
    # Ensure first column has at least 35% of total width for label-heavy tables
    if n_cols == 3 and widths[0] / sum(widths) < 0.30:
        widths[0] = sum(widths) * 0.32
    widths = [max(w, min_col) for w in widths]
    total = sum(widths)
    return [w / total * CONTENT_W for w in widths]


def _wrap_text(pdf, text, width):
    """Split text into lines that fit within width. Returns list of strings."""
    if not text:
        return [""]
    words = list(text)  # character-level for CJK
    result_lines = []
    current = ""
    for ch in words:
        test = current + ch
        if pdf.get_string_width(test) > width - 4:
            if current:
                result_lines.append(current)
            current = ch
        else:
            current = test
    if current:
        result_lines.append(current)
    return result_lines if result_lines else [""]


def _render_table(pdf, headers, rows):
    """Render table with multi-line cell support."""
    n_cols = len(headers)
    if n_cols == 0:
        return

    col_widths = _calc_col_widths(pdf, headers, rows, n_cols)
    cell_lh = TABLE_BODY_SIZE * 0.50  # line height within cells

    pdf.ln(5)

    # ---- Header row ----
    pdf.set_font("msyh", "B", TABLE_HEADER_SIZE)
    # Compute header row height (multi-line headers)
    header_lines = []
    max_lines = 1
    for j, h in enumerate(headers):
        lines = _wrap_text(pdf, strip_md(h), col_widths[j])
        header_lines.append(lines)
        max_lines = max(max_lines, len(lines))
    header_h = max_lines * cell_lh + TABLE_CELL_PAD * 2

    pdf.set_fill_color(*COLOR_TABLE_HEAD_BG)
    pdf.set_text_color(*COLOR_TABLE_HEAD_TEXT)
    pdf.set_draw_color(*COLOR_TABLE_HEAD_BG)

    x0 = MARGIN_L
    y0 = pdf.get_y()
    # Draw header background
    pdf.rect(x0, y0, CONTENT_W, header_h, "F")
    # Draw header text
    for j in range(n_cols):
        x = x0 + sum(col_widths[:j])
        for li, line in enumerate(header_lines[j]):
            pdf.set_xy(x + 2, y0 + TABLE_CELL_PAD + li * cell_lh)
            pdf.cell(col_widths[j] - 4, cell_lh, line, new_x="END", new_y="TOP")
    pdf.set_y(y0 + header_h)

    # ---- Body rows ----
    for r_idx, row in enumerate(rows):
        # Compute row height
        pdf.set_font("msyh", "", TABLE_BODY_SIZE)
        row_lines = []
        max_lines = 1
        for j in range(n_cols):
            cell_text = strip_md(row[j]) if j < len(row) else ""
            if j == 0:
                pdf.set_font("msyh", "B", TABLE_BODY_SIZE)
            else:
                pdf.set_font("msyh", "", TABLE_BODY_SIZE)
            lines = _wrap_text(pdf, cell_text, col_widths[j])
            row_lines.append(lines)
            max_lines = max(max_lines, len(lines))
        row_h = max_lines * cell_lh + TABLE_CELL_PAD * 2

        # Page break check
        if pdf.get_y() + row_h > PAGE_H - MARGIN_B:
            pdf.add_page()

        y0 = pdf.get_y()

        # Row background
        if r_idx % 2 == 1:
            pdf.set_fill_color(*COLOR_TABLE_STRIPE)
        else:
            pdf.set_fill_color(255, 255, 255)
        pdf.rect(x0, y0, CONTENT_W, row_h, "F")

        # Bottom border
        pdf.set_draw_color(*COLOR_TABLE_BORDER)
        pdf.set_line_width(0.2)
        pdf.line(x0, y0 + row_h, x0 + CONTENT_W, y0 + row_h)

        # Vertical borders
        cx = x0
        for j in range(n_cols + 1):
            if j > 0 and j < n_cols:
                pdf.set_draw_color(230, 235, 240)
                pdf.line(cx, y0, cx, y0 + row_h)
            cx += col_widths[j] if j < n_cols else 0

        # Cell text
        for j in range(n_cols):
            x = x0 + sum(col_widths[:j])
            if j == 0:
                pdf.set_font("msyh", "B", TABLE_BODY_SIZE)
                pdf.set_text_color(*COLOR_TABLE_FIRST_COL)
            else:
                pdf.set_font("msyh", "", TABLE_BODY_SIZE)
                pdf.set_text_color(*COLOR_BODY)
            for li, line in enumerate(row_lines[j]):
                pdf.set_xy(x + 2, y0 + TABLE_CELL_PAD + li * cell_lh)
                pdf.cell(col_widths[j] - 4, cell_lh, line, new_x="END", new_y="TOP")

        pdf.set_y(y0 + row_h)

    pdf.ln(5)


# ---------------------------------------------------------------------------
# Main renderer
# ---------------------------------------------------------------------------
def render_pdf(blocks, output_path):
    pdf = MdPdf()
    pdf.alias_nb_pages()

    # Detect title for page headers
    for b in blocks:
        if b[0] == "h1":
            pdf.doc_title = strip_md(b[1])
            break

    pdf.add_page()

    for block in blocks:
        btype = block[0]

        # ---- H1 (document title) ----
        if btype == "h1":
            text = strip_md(block[1])
            pdf.ln(10)
            pdf.set_font("msyh", "B", TITLE_SIZE)
            pdf.set_text_color(*COLOR_TITLE)
            pdf.multi_cell(CONTENT_W, TITLE_SIZE * 0.48, text,
                           align="C", new_x="LMARGIN", new_y="NEXT")
            # Decorative accent line
            y = pdf.get_y() + 3
            pdf.set_draw_color(*COLOR_TITLE_LINE)
            pdf.set_line_width(0.6)
            line_w = 50
            x_start = MARGIN_L + (CONTENT_W - line_w) / 2
            pdf.line(x_start, y, x_start + line_w, y)
            pdf.set_line_width(0.2)
            pdf.set_y(y + 7)

        # ---- H2 ----
        elif btype == "h2":
            text = strip_md(block[1])
            if pdf.get_y() > PAGE_H - 55:
                pdf.add_page()
            pdf.ln(10)
            y0 = pdf.get_y()
            pdf.set_font("msyh", "B", H2_SIZE)
            pdf.set_text_color(*COLOR_H2)
            # Accent bar
            bar_h = H2_SIZE * 0.48 + 1
            pdf.set_fill_color(*COLOR_H2_BAR)
            pdf.rect(MARGIN_L, y0, 1.2, bar_h, "F")
            pdf.set_x(MARGIN_L + 5)
            pdf.multi_cell(CONTENT_W - 5, H2_SIZE * 0.48, text,
                           new_x="LMARGIN", new_y="NEXT")
            pdf.ln(4)

        # ---- H3 ----
        elif btype == "h3":
            text = strip_md(block[1])
            if pdf.get_y() > PAGE_H - 45:
                pdf.add_page()
            pdf.ln(7)
            pdf.set_font("msyh", "B", H3_SIZE)
            pdf.set_text_color(*COLOR_H2)
            pdf.multi_cell(CONTENT_W, H3_SIZE * 0.48, text,
                           new_x="LMARGIN", new_y="NEXT")
            pdf.ln(3)

        # ---- Paragraph ----
        elif btype == "p":
            text = _normalize_text(strip_md(block[1]))
            pdf.set_font("msyh", "", BODY_SIZE)
            pdf.set_text_color(*COLOR_BODY)
            indent = 2 * BODY_SIZE * 0.352  # 2em
            avail_w = CONTENT_W - indent

            # Orphan protection
            lines = _smart_wrap(pdf, text, avail_w)
            remaining_space = (PAGE_H - MARGIN_B) - pdf.get_y()
            lines_that_fit = remaining_space / BODY_LH
            if len(lines) > 2 and 0 < lines_that_fit < 2.5:
                pdf.add_page()

            _write_paragraph(pdf, text, MARGIN_L + indent, avail_w, BODY_LH)
            pdf.ln(3)

        # ---- Table ----
        elif btype == "table":
            _, headers, rows = block
            _render_table(pdf, headers, rows)

        # ---- Ordered list ----
        elif btype == "ol":
            items = block[1]
            pdf.ln(3)
            for j, item in enumerate(items):
                text = _normalize_text(strip_md(item))
                num_str = f"{j + 1}."
                pdf.set_font("msyh", "B", BODY_SIZE)
                pdf.set_text_color(*COLOR_LIST_NUM)
                num_w = pdf.get_string_width(num_str) + 2
                indent_x = MARGIN_L + 5
                pdf.set_x(indent_x)
                y_num = pdf.get_y()
                pdf.cell(num_w, BODY_LH, num_str, new_x="END", new_y="TOP")

                pdf.set_font("msyh", "", BODY_SIZE)
                pdf.set_text_color(*COLOR_BODY)
                text_x = indent_x + num_w
                text_w = CONTENT_W - 5 - num_w
                pdf.set_xy(text_x, y_num)
                _write_text_block(pdf, text, text_x, text_w, BODY_LH)
                pdf.ln(3)
            pdf.ln(2)

        # ---- Unordered list ----
        elif btype == "ul":
            items = block[1]
            pdf.ln(3)
            for item in items:
                text = _normalize_text(strip_md(item))
                pdf.set_font("msyh", "", BODY_SIZE)
                pdf.set_text_color(*COLOR_BODY)
                indent_x = MARGIN_L + 5
                pdf.set_x(indent_x)
                y0 = pdf.get_y()
                pdf.cell(4, BODY_LH, "\u2022", new_x="END", new_y="TOP")
                pdf.set_xy(indent_x + 5, y0)
                _write_text_block(pdf, text, indent_x + 5, CONTENT_W - 10, BODY_LH)
                pdf.ln(2)
            pdf.ln(2)

    pdf.output(output_path)
    print(f"PDF saved: {output_path}")
    return output_path


def convert(md_path, pdf_path=None):
    if pdf_path is None:
        pdf_path = os.path.splitext(md_path)[0] + ".pdf"
    with open(md_path, "r", encoding="utf-8") as f:
        md_text = f.read()
    blocks = parse_md(md_text)
    render_pdf(blocks, pdf_path)
    return pdf_path


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python md2pdf.py <input.md> [output.pdf]")
        sys.exit(1)
    input_md = sys.argv[1]
    output_pdf = sys.argv[2] if len(sys.argv) > 2 else None
    convert(input_md, output_pdf)
