"""Builds the attachment fixtures the cells send.

    uv run --with pillow --with reportlab python make_assets.py

The fixtures are generated rather than committed, so the repository carries
no binaries and the content stays described by the code that makes it. Each
one carries a detail a model can only report if it received the bytes: the
two words and two shapes in the picture, and the invoice number and total in
the document.

`_common.py` calls this on demand, so a cell run builds whatever is missing.
"""

from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "assets"

IMAGE_PNG = ASSETS / "langwatch-shapes.png"
IMAGE_JPG = ASSETS / "langwatch-shapes.jpg"
PDF = ASSETS / "langwatch-invoice.pdf"

INVOICE_NUMBER = "LW-DOGFOOD-7339"
INVOICE_TOTAL = "1337.42 EUR"

ORANGE = (234, 88, 12)
BLUE = (37, 99, 235)
GREEN = (22, 163, 74)
CREAM = (254, 243, 224)
WHITE = (255, 255, 255)
INK = (23, 23, 23)


def _font(size: int):
    from PIL import ImageFont

    for name in ("DejaVuSans-Bold.ttf", "Arial Bold.ttf", "Helvetica.ttc"):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            continue
    return ImageFont.load_default()


def build_image() -> None:
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (640, 420), CREAM)
    draw = ImageDraw.Draw(image)

    draw.rectangle([0, 0, 640, 88], fill=ORANGE)
    draw.text((24, 16), "LANGWATCH", font=_font(38), fill=WHITE)
    draw.text((26, 60), "MULTIMODAL DOGFOOD", font=_font(16), fill=WHITE)

    draw.ellipse([56, 150, 216, 310], fill=BLUE)
    draw.polygon([(370, 310), (450, 150), (530, 310)], fill=GREEN)
    draw.text((26, 360), "a blue circle and a green triangle", font=_font(15), fill=INK)

    ASSETS.mkdir(parents=True, exist_ok=True)
    image.save(IMAGE_PNG, "PNG")
    image.save(IMAGE_JPG, "JPEG", quality=88)


def build_pdf() -> None:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfgen import canvas

    ASSETS.mkdir(parents=True, exist_ok=True)
    page = canvas.Canvas(str(PDF), pagesize=A4)
    width, height = A4

    page.setFont("Helvetica-Bold", 22)
    page.drawString(56, height - 80, "LangWatch Dogfood Invoice")

    page.setFont("Helvetica", 13)
    page.drawString(56, height - 120, f"Invoice number: {INVOICE_NUMBER}")
    page.drawString(56, height - 142, "Billed to: ACME Freight")
    page.drawString(56, height - 164, "Description: Multimodal capture check")

    page.setFont("Helvetica-Bold", 15)
    page.drawString(56, height - 200, f"Total due: {INVOICE_TOTAL}")

    page.showPage()
    page.save()


def build_missing() -> None:
    """Builds only what is not there yet, so a cell run is cheap."""
    if not (IMAGE_PNG.exists() and IMAGE_JPG.exists()):
        build_image()
    if not PDF.exists():
        build_pdf()


if __name__ == "__main__":
    build_image()
    build_pdf()
    print(f"wrote {IMAGE_PNG.name}, {IMAGE_JPG.name} and {PDF.name} to {ASSETS}")
