"""Tests for image detection and multipart content support."""

import pytest
from langevals_core.image_support import (
    detect_image,
    build_content_parts,
    is_data_uri_image,
    is_image_url,
)


# ============================================================================
# detect_image
# ============================================================================


class TestDetectImage:
    """detect_image returns an image URL/data-URI when the whole string is
    an image, None otherwise."""

    # --- Data URIs ---

    class TestWhenDataUri:
        def test_detects_png_data_uri(self):
            uri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
            assert detect_image(uri) == uri

        def test_detects_jpeg_data_uri(self):
            uri = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
            assert detect_image(uri) == uri

        def test_detects_with_surrounding_whitespace(self):
            uri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
            assert detect_image(f"  {uri}  ") == uri

        def test_rejects_non_image_data_uri(self):
            assert detect_image("data:text/plain;base64,aGVsbG8=") is None

    # --- Image URLs ---

    class TestWhenImageUrl:
        def test_detects_png_url(self):
            url = "https://example.com/photo.png"
            assert detect_image(url) == url

        def test_detects_jpg_url(self):
            url = "https://example.com/photo.jpg"
            assert detect_image(url) == url

        def test_detects_jpeg_url(self):
            url = "https://example.com/photo.jpeg"
            assert detect_image(url) == url

        def test_detects_gif_url(self):
            url = "https://example.com/anim.gif"
            assert detect_image(url) == url

        def test_detects_webp_url(self):
            url = "https://cdn.example.com/photo.webp"
            assert detect_image(url) == url

        def test_detects_svg_url(self):
            url = "https://example.com/icon.svg"
            assert detect_image(url) == url

        def test_detects_with_query_params(self):
            url = "https://example.com/photo.png?w=800&h=600"
            assert detect_image(url) == url

        def test_detects_case_insensitive_extension(self):
            url = "https://example.com/Photo.PNG"
            assert detect_image(url) == url

        def test_rejects_non_image_url(self):
            assert detect_image("https://example.com/page.html") is None

        def test_rejects_url_without_extension(self):
            assert detect_image("https://example.com/api/resource") is None

    # --- Markdown image syntax ---

    class TestWhenMarkdownImage:
        def test_detects_markdown_with_png_url(self):
            md = "![alt text](https://example.com/photo.png)"
            assert detect_image(md) == "https://example.com/photo.png"

        def test_detects_markdown_with_data_uri(self):
            uri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
            md = f"![screenshot]({uri})"
            assert detect_image(md) == uri

        def test_detects_markdown_with_empty_alt(self):
            md = "![](https://example.com/img.jpg)"
            assert detect_image(md) == "https://example.com/img.jpg"

        def test_rejects_markdown_with_non_image_url(self):
            md = "![link](https://example.com/page.html)"
            assert detect_image(md) is None

    # --- Not images ---

    class TestWhenNotImage:
        def test_rejects_plain_text(self):
            assert detect_image("Hello, world!") is None

        def test_rejects_empty_string(self):
            assert detect_image("") is None

        def test_rejects_text_with_embedded_url(self):
            assert (
                detect_image("Check this out: https://example.com/photo.png")
                is None
            )

        def test_rejects_text_with_embedded_markdown_image(self):
            assert (
                detect_image(
                    "Here is the pic: ![img](https://example.com/photo.png)"
                )
                is None
            )

        def test_rejects_multiline_text_with_url(self):
            text = "Some text\nhttps://example.com/photo.png\nMore text"
            assert detect_image(text) is None

        def test_rejects_ftp_url(self):
            assert detect_image("ftp://example.com/photo.png") is None


# ============================================================================
# is_data_uri_image
# ============================================================================


class TestIsDataUriImage:
    def test_accepts_image_data_uri(self):
        assert is_data_uri_image("data:image/png;base64,abc") is True

    def test_rejects_non_image_data_uri(self):
        assert is_data_uri_image("data:text/plain;base64,abc") is False

    def test_rejects_plain_text(self):
        assert is_data_uri_image("hello") is False


# ============================================================================
# is_image_url
# ============================================================================


class TestIsImageUrl:
    def test_accepts_https_png(self):
        assert is_image_url("https://example.com/img.png") is True

    def test_accepts_http_jpg(self):
        assert is_image_url("http://example.com/img.jpg") is True

    def test_rejects_non_image_extension(self):
        assert is_image_url("https://example.com/doc.pdf") is False

    def test_rejects_no_extension(self):
        assert is_image_url("https://example.com/path") is False


# ============================================================================
# build_content_parts
# ============================================================================


class TestBuildContentParts:
    """build_content_parts returns a string for text-only content and a list of
    content parts when images are present."""

    class TestWhenAllText:
        def test_returns_string(self):
            result = build_content_parts(
                input="hello",
                output="world",
                task="Evaluate this",
            )
            assert isinstance(result, str)
            assert "# Input\nhello" in result
            assert "# Output\nworld" in result
            assert "# Task\nEvaluate this" in result

        def test_omits_none_fields(self):
            result = build_content_parts(
                input="hello",
                output=None,
                task="Evaluate",
            )
            assert isinstance(result, str)
            assert "# Input\nhello" in result
            assert "# Output" not in result

        def test_includes_contexts(self):
            result = build_content_parts(
                input="q",
                output="a",
                contexts=["ctx1", "ctx2"],
                task="Evaluate",
            )
            assert isinstance(result, str)
            assert "# Contexts" in result

        def test_includes_expected_output(self):
            result = build_content_parts(
                input="q",
                output="a",
                expected_output="expected",
                task="Evaluate",
            )
            assert isinstance(result, str)
            assert "# Expected Output\nexpected" in result

    class TestWhenInputIsImage:
        def test_returns_list_of_content_parts(self):
            result = build_content_parts(
                input="https://example.com/photo.png",
                output="This is a cat",
                task="Evaluate this",
            )
            assert isinstance(result, list)

        def test_input_becomes_image_part(self):
            result = build_content_parts(
                input="https://example.com/photo.png",
                output="This is a cat",
                task="Evaluate this",
            )
            assert isinstance(result, list)
            # Find the image part
            image_parts = [p for p in result if p["type"] == "image_url"]
            assert len(image_parts) == 1
            assert image_parts[0]["image_url"]["url"] == "https://example.com/photo.png"  # type: ignore

        def test_output_stays_as_text(self):
            result = build_content_parts(
                input="https://example.com/photo.png",
                output="This is a cat",
                task="Evaluate this",
            )
            assert isinstance(result, list)
            text_parts = [p for p in result if p["type"] == "text"]
            text_content = " ".join(p["text"] for p in text_parts)  # type: ignore
            assert "This is a cat" in text_content

        def test_task_is_always_text(self):
            result = build_content_parts(
                input="https://example.com/photo.png",
                output="desc",
                task="Judge the output",
            )
            assert isinstance(result, list)
            last_part = result[-1]
            assert last_part["type"] == "text"
            assert "Judge the output" in last_part["text"]  # type: ignore

    class TestWhenOutputIsImage:
        def test_output_becomes_image_part(self):
            result = build_content_parts(
                input="Describe this",
                output="https://example.com/generated.png",
                task="Evaluate",
            )
            assert isinstance(result, list)
            image_parts = [p for p in result if p["type"] == "image_url"]
            assert len(image_parts) == 1
            assert image_parts[0]["image_url"]["url"] == "https://example.com/generated.png"  # type: ignore

    class TestWhenMultipleFieldsAreImages:
        def test_all_images_become_image_parts(self):
            result = build_content_parts(
                input="https://example.com/input.png",
                output="https://example.com/output.jpg",
                task="Compare images",
            )
            assert isinstance(result, list)
            image_parts = [p for p in result if p["type"] == "image_url"]
            assert len(image_parts) == 2

    class TestWhenContextIsImage:
        def test_context_image_becomes_image_part(self):
            result = build_content_parts(
                input="question",
                output="answer",
                contexts=["https://example.com/context.png"],
                task="Evaluate",
            )
            assert isinstance(result, list)
            image_parts = [p for p in result if p["type"] == "image_url"]
            assert len(image_parts) == 1
            assert image_parts[0]["image_url"]["url"] == "https://example.com/context.png"  # type: ignore

        def test_mixed_text_and_image_contexts(self):
            result = build_content_parts(
                input="question",
                output="answer",
                contexts=["text context", "https://example.com/img.png"],
                task="Evaluate",
            )
            assert isinstance(result, list)
            image_parts = [p for p in result if p["type"] == "image_url"]
            assert len(image_parts) == 1

    class TestWhenMarkdownImage:
        def test_markdown_image_in_input(self):
            result = build_content_parts(
                input="![photo](https://example.com/photo.png)",
                output="A landscape",
                task="Evaluate",
            )
            assert isinstance(result, list)
            image_parts = [p for p in result if p["type"] == "image_url"]
            assert len(image_parts) == 1
            assert image_parts[0]["image_url"]["url"] == "https://example.com/photo.png"  # type: ignore

    class TestWhenDataUriImage:
        def test_data_uri_in_input(self):
            uri = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="
            result = build_content_parts(
                input=uri,
                output="A photo",
                task="Evaluate",
            )
            assert isinstance(result, list)
            image_parts = [p for p in result if p["type"] == "image_url"]
            assert len(image_parts) == 1
            assert image_parts[0]["image_url"]["url"] == uri  # type: ignore

    class TestWhenExpectedOutputIsImage:
        def test_expected_output_becomes_image_part(self):
            result = build_content_parts(
                input="prompt",
                output="result",
                expected_output="https://example.com/expected.png",
                task="Compare",
            )
            assert isinstance(result, list)
            image_parts = [p for p in result if p["type"] == "image_url"]
            assert len(image_parts) == 1
            assert image_parts[0]["image_url"]["url"] == "https://example.com/expected.png"  # type: ignore
