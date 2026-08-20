"""Shared plumbing for the multimodal dogfood cells.

Every cell sends one model call carrying one attachment and reports it to
LangWatch. What differs between cells is the SDK and the wire shape of the
attachment; everything else lives here so a cell reads as the integration
snippet a customer would copy.
"""

import base64
import os
import sys
from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "assets"

IMAGE = ASSETS / "langwatch-shapes.png"
PDF = ASSETS / "langwatch-invoice.pdf"

IMAGE_QUESTION = "What does this image show? Name the words and the shapes."
PDF_QUESTION = "What is the invoice number and the total due in this document?"


def modality() -> str:
    """`image` (default) or `pdf`, from the first argument."""
    value = sys.argv[1] if len(sys.argv) > 1 else "image"
    if value not in ("image", "pdf"):
        raise SystemExit(f"unknown modality {value!r}: expected image or pdf")
    return value


def attachment(kind: str) -> tuple[Path, str]:
    """The file for a modality, with its media type."""
    return (IMAGE, "image/png") if kind == "image" else (PDF, "application/pdf")


def question(kind: str) -> str:
    return IMAGE_QUESTION if kind == "image" else PDF_QUESTION


def b64(path: Path) -> str:
    return base64.b64encode(path.read_bytes()).decode("utf-8")


def data_url(path: Path, media_type: str) -> str:
    return f"data:{media_type};base64,{b64(path)}"


def require(*names: str) -> None:
    """Fail with a readable message rather than a stack trace 40 lines in."""
    missing = [name for name in names if not os.environ.get(name)]
    if missing:
        raise SystemExit(f"missing environment: {', '.join(missing)}")


def report(cell: str, answer: str) -> None:
    """One line per cell, so the runner's output stays readable."""
    print(f"[{cell}] {answer.strip()[:280]}")
