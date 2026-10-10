"""Contexts reach the judge as a numbered list, one chunk per line, empty chunks dropped."""

from langevals_core.image_support import build_content_parts


def test_text_contexts_are_numbered_one_per_line():
    content = build_content_parts(
        input="q", output="a", contexts=["Paris is in France.", "Rome is in Italy."], task="T"
    )

    assert "# Contexts\n1. Paris is in France.\n2. Rome is in Italy.\n\n" in content


def test_empty_contexts_are_skipped():
    content = build_content_parts(
        input="q", output="a", contexts=["", "Only chunk.", "   "], task="T"
    )

    assert "# Contexts\n1. Only chunk.\n\n" in content


def test_only_empty_contexts_render_no_section():
    content = build_content_parts(input="q", output="a", contexts=[""], task="T")

    assert "# Contexts" not in content


def test_image_path_numbers_text_contexts_the_same_way():
    parts = build_content_parts(
        input="q",
        output="a",
        contexts=["", "first", "https://example.com/img.png", "second"],
        task="T",
    )

    texts = [part["text"] for part in parts if part.get("type") == "text"]
    assert "# Contexts\n1. first" in texts
    assert "# Contexts\n3. second" in texts
