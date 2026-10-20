#!/usr/bin/env python3
"""Generate the Glitch attendance QR code and printable A4 poster.

Usage:
    pip install -r tools/requirements.txt
    python3 tools/generate_qr_poster.py https://forms.gle/xxxxxx

Outputs (into poster/ by default):
    qr-code.png              the QR code itself (border + quiet zone)
    attendance-poster.png    full A4 poster with steps, QR, and today's-code box

Options:
    -h --help
    --qr-out PATH        PNG path for the QR code (default: poster/qr-code.png)
    --poster-out PATH    PNG path for the A4 poster (default: poster/attendance-poster.png)
"""

import argparse
import os
import sys

try:
    import qrcode
    from qrcode.constants import ERROR_CORRECT_H
except ImportError:  # pragma: no cover
    sys.exit(
        "Missing dependency 'qrcode'. Install it with:\n"
        "    pip install -r tools/requirements.txt"
    )

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover
    sys.exit(
        "Missing dependency 'Pillow'. Install it with:\n"
        "    pip install -r tools/requirements.txt"
    )

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# A4 @ 300 DPI
POSTER_W, POSTER_H = 2480, 3508
MARGIN = 120

BG_DARK = (16, 19, 34)
BG_PANEL = (27, 33, 64)
ACCENT = (124, 227, 139)
WHITE = (255, 255, 255)
MUTED = (154, 163, 199)
GRAY = (90, 95, 120)

_FONT_CANDIDATES = [
    # macOS
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    # Windows
    "C:/Windows/Fonts/arialbd.ttf",
    "C:/Windows/Fonts/arial.ttf",
    # Linux
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
]


def load_font(size: int, bold: bool) -> ImageFont.FreeTypeFont:
    for path in _FONT_CANDIDATES:
        if bold and "Bold" not in path and "bd" not in path and ".ttc" not in path:
            continue
        if not bold and "Bold" in path:
            continue
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    raise RuntimeError(f"No usable font found (tried {_FONT_CANDIDATES})")


def _center_text(
    draw: ImageDraw.ImageDraw,
    xy_mid: tuple[int, int],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int] = WHITE,
) -> None:
    bbox = draw.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    draw.text((xy_mid[0] - w / 2 - bbox[0], xy_mid[1] - h / 2 - bbox[1]), text, font=font, fill=fill)


def _left_text(
    draw: ImageDraw.ImageDraw,
    xy: tuple[int, int],
    text: str,
    font: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int] = WHITE,
) -> None:
    draw.text((xy[0], xy[1]), text, font=font, fill=fill)


def render_qr(url: str, out: str) -> Image.Image:
    qr = qrcode.QRCode(
        version=None,
        error_correction=ERROR_CORRECT_H,
        box_size=12,
        border=4,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color=BG_DARK, back_color=WHITE).convert("RGB")
    img.save(out, "PNG")
    return img


def render_poster(qr_img: Image.Image, out: str) -> None:
    qr_size = 1500
    qr_img = qr_img.resize((qr_size, qr_size), Image.LANCZOS)

    img = Image.new("RGB", (POSTER_W, POSTER_H), BG_DARK)
    draw = ImageDraw.Draw(img)

    # Header panel
    draw.rectangle([0, 0, POSTER_W, 560], fill=BG_PANEL)
    draw.rectangle([0, 552, POSTER_W, 560], fill=ACCENT)

    title = load_font(150, bold=True)
    subtitle = load_font(80, bold=False)
    body = load_font(72, bold=False)
    bold = load_font(72, bold=True)
    small = load_font(56, bold=False)

    _center_text(draw, (POSTER_W // 2, 210), "GLITCH ROBOTICS", title, ACCENT)
    _center_text(draw, (POSTER_W // 2, 400), "ATTENDANCE SIGN-IN", subtitle, WHITE)

    # How to sign in
    y = 680
    _left_text(draw, (MARGIN, y), "HOW TO SIGN IN", bold, ACCENT)
    y += 140
    steps = [
        ("1.", " Scan the QR code with your phone camera"),
        ("2.", " Select your name from the dropdown"),
        ("3.", " Enter today's code exactly as shown"),
        ("4.", " Tap Submit — you're done"),
    ]
    for num, rest in steps:
        _left_text(draw, (MARGIN + 20, y), num, bold, WHITE)
        _left_text(draw, (MARGIN + 150, y), rest, body, WHITE)
        y += 110

    # QR block
    qr_x = (POSTER_W - qr_size) // 2
    qr_y = y + 80
    pad = 24
    draw.rectangle([qr_x - pad, qr_y - pad, qr_x + qr_size + pad, qr_y + qr_size + pad], fill=WHITE)
    img.paste(qr_img, (qr_x, qr_y))

    # Today's code box
    box_y = qr_y + qr_size + pad + 120
    _left_text(draw, (MARGIN, box_y), "TODAY'S CODE:", bold, ACCENT)
    box_top = box_y + 120
    draw.rectangle([MARGIN, box_top, POSTER_W - MARGIN, box_top + 220], fill=WHITE)
    _center_text(draw, (POSTER_W // 2, box_top + 110), "GL-              (mentor: write today's code)", body, GRAY)

    # Footer
    _center_text(draw, (POSTER_W // 2, box_top + 330), "Sign in once per practice - ask a mentor if you need help", small, MUTED)

    img.save(out, "PNG")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate Glitch attendance QR + A4 poster")
    parser.add_argument("url", help="The forms.gle short link (or full form URL)")
    parser.add_argument("--qr-out", default=os.path.join(REPO_ROOT, "poster", "qr-code.png"))
    parser.add_argument("--poster-out", default=os.path.join(REPO_ROOT, "poster", "attendance-poster.png"))
    args = parser.parse_args()

    if not args.url.startswith(("http://", "https://")):
        sys.exit(f"Expected a URL, got: {args.url!r}")

    for path in (args.qr_out, args.poster_out):
        os.makedirs(os.path.dirname(path) or ".", exist_ok=True)

    qr_img = render_qr(args.url, args.qr_out)
    render_poster(qr_img, args.poster_out)
    print(f"QR code:     {args.qr_out}")
    print(f"A4 poster:   {args.poster_out}")


if __name__ == "__main__":
    main()