"""
Image detection and multipart content support for LLM-as-a-judge evaluators.

When evaluator fields (input, output, expected_output, contexts) contain image
references (URLs, base64 data URIs, markdown image syntax), the LLM message
content is converted from a plain string to a list of content parts so that
vision-capable models can process them.

Detection is strict: only fields whose ENTIRE value is an image reference are
treated as images. Mixed text+image strings are sent as plain text.
"""

import re
from typing import Union
from urllib.parse import urlparse

IMAGE_EXTENSIONS = frozenset(
    {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".tiff"}
)

_MARKDOWN_IMAGE_RE = re.compile(r"^!\[([^\]]*)\]\((.+)\)$", re.DOTALL)

ContentPart = dict[str, object]


def is_data_uri_image(value: str) -> bool:
    """Check if a string is a base64 data URI for an image."""
    return value.startswith("data:image/")


def is_image_url(url: str) -> bool:
    """Check if a URL points to an image based on its file extension."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        path_lower = parsed.path.lower()
        return any(path_lower.endswith(ext) for ext in IMAGE_EXTENSIONS)
    except Exception:
        return False


def detect_image(value: str) -> str | None:
    """
    Check if the entire string represents a single image.

    Returns the image URL or data-URI if detected, None otherwise.
    Only triggers when the WHOLE string is an image reference — mixed
    text+image strings return None.
    """
    stripped = value.strip()
    if not stripped:
        return None

    # Base64 data URI
    if is_data_uri_image(stripped):
        return stripped

    # Plain image URL
    if is_image_url(stripped):
        return stripped

    # Markdown image: ![alt](url)
    match = _MARKDOWN_IMAGE_RE.match(stripped)
    if match:
        url = match.group(2).strip()
        if is_data_uri_image(url) or is_image_url(url):
            return url

    return None


def _make_image_part(url: str) -> ContentPart:
    return {"type": "image_url", "image_url": {"url": url}}


def _make_text_part(text: str) -> ContentPart:
    return {"type": "text", "text": text}


def build_content_parts(
    *,
    input: str | None = None,
    output: str | None = None,
    contexts: list[str] | None = None,
    expected_output: str | None = None,
    task: str,
) -> Union[str, list[ContentPart]]:
    """
    Build user-message content for LLM-as-a-judge evaluators.

    When all fields are plain text, returns a single string (preserving the
    existing ``# Input\\n...\\n\\n# Output\\n...`` format).

    When any field is detected as an image, returns a list of content parts
    suitable for litellm's multipart message format.
    """

    # Detect images in each field
    fields: list[tuple[str, str | None, str | None]] = []
    has_image = False

    for label, value in [
        ("Input", input),
        ("Output", output),
        ("Expected Output", expected_output),
    ]:
        if value:
            img = detect_image(value)
            if img:
                has_image = True
            fields.append((label, value, img))
        else:
            fields.append((label, None, None))

    ctx_images: list[str | None] = []
    if contexts:
        for ctx in contexts:
            img = detect_image(ctx)
            if img:
                has_image = True
            ctx_images.append(img)

    # --- Plain text path (no images detected) ---
    if not has_image:
        content = ""
        for label, value, _ in fields:
            if value:
                content += f"# {label}\n{value}\n\n"
        if contexts:
            content += f"# Contexts\n{'1. '.join(contexts)}\n\n"
        content += f"# Task\n{task}"
        return content

    # --- Multipart path (at least one image) ---
    parts: list[ContentPart] = []

    for label, value, img_url in fields:
        if not value:
            continue
        if img_url:
            parts.append(_make_text_part(f"# {label}"))
            parts.append(_make_image_part(img_url))
        else:
            parts.append(_make_text_part(f"# {label}\n{value}"))

    if contexts:
        ctx_header_parts: list[str] = []
        for i, (ctx, img) in enumerate(zip(contexts, ctx_images)):
            if img:
                # Flush any accumulated text
                if ctx_header_parts:
                    parts.append(_make_text_part("# Contexts\n" + "\n".join(ctx_header_parts)))
                    ctx_header_parts = []
                else:
                    parts.append(_make_text_part("# Contexts"))
                parts.append(_make_image_part(img))
            else:
                ctx_header_parts.append(f"{i + 1}. {ctx}")
        if ctx_header_parts:
            parts.append(_make_text_part("# Contexts\n" + "\n".join(ctx_header_parts)))

    parts.append(_make_text_part(f"# Task\n{task}"))

    return parts
