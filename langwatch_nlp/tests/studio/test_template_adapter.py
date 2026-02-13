"""
Unit tests for TemplateAdapter.

Tests the _filter_empty_content_messages function, format() method,
and Liquid template rendering through the adapter.

Covers:
- Anthropic empty content block filtering (regression: "text content blocks must be non-empty")
- Liquid condition and loop rendering in message templates
"""

import pytest
from langwatch_nlp.studio.dspy.template_adapter import (
    _filter_empty_content_messages,
    TemplateAdapter,
)


class TestFilterEmptyContentMessages:
    """Tests for _filter_empty_content_messages helper function."""

    # String content filtering

    def test_filters_message_with_none_content(self):
        """Given message with None content, removes the message."""
        messages = [{"role": "user", "content": None}]

        result = _filter_empty_content_messages(messages)

        assert result == []

    def test_filters_message_with_empty_string_content(self):
        """Given message with empty string content, removes the message."""
        messages = [{"role": "user", "content": ""}]

        result = _filter_empty_content_messages(messages)

        assert result == []

    def test_filters_message_with_whitespace_only_content(self):
        """Given message with whitespace-only content, removes the message."""
        messages = [{"role": "user", "content": "   "}]

        result = _filter_empty_content_messages(messages)

        assert result == []

    def test_preserves_message_with_non_empty_string_content(self):
        """Given message with non-empty string content, preserves the message."""
        messages = [{"role": "user", "content": "Hello"}]

        result = _filter_empty_content_messages(messages)

        assert result == [{"role": "user", "content": "Hello"}]

    # List content filtering

    def test_filters_empty_text_blocks_from_list_content(self):
        """Given message with empty and non-empty text blocks, filters empty ones."""
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": ""},
                    {"type": "text", "text": "Hello"},
                ],
            }
        ]

        result = _filter_empty_content_messages(messages)

        assert result == [
            {"role": "user", "content": [{"type": "text", "text": "Hello"}]}
        ]

    def test_filters_whitespace_text_blocks_from_list_content(self):
        """Given message with whitespace text blocks, filters them."""
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "   "},
                    {"type": "text", "text": "Hello"},
                ],
            }
        ]

        result = _filter_empty_content_messages(messages)

        assert result == [
            {"role": "user", "content": [{"type": "text", "text": "Hello"}]}
        ]

    def test_removes_message_if_all_content_blocks_are_empty(self):
        """Given message with only empty text blocks, removes the message."""
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": ""},
                    {"type": "text", "text": "   "},
                ],
            }
        ]

        result = _filter_empty_content_messages(messages)

        assert result == []

    def test_preserves_non_text_blocks(self):
        """Given message with empty text block and image block, preserves image."""
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": ""},
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}},
                ],
            }
        ]

        result = _filter_empty_content_messages(messages)

        assert result == [
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": "data:image/png;base64,abc"}}
                ],
            }
        ]

    def test_preserves_image_type_blocks(self):
        """Given message with image type block, preserves it."""
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "image", "source": {"data": "abc"}},
                ],
            }
        ]

        result = _filter_empty_content_messages(messages)

        assert result == [
            {
                "role": "user",
                "content": [{"type": "image", "source": {"data": "abc"}}],
            }
        ]

    # Mixed scenarios

    def test_filters_multiple_messages(self):
        """Given multiple messages, filters each appropriately."""
        messages = [
            {"role": "system", "content": ""},
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": None},
        ]

        result = _filter_empty_content_messages(messages)

        assert result == [{"role": "user", "content": "Hello"}]

    def test_preserves_message_order(self):
        """Given multiple valid messages, preserves their order."""
        messages = [
            {"role": "system", "content": "You are helpful"},
            {"role": "user", "content": "Hello"},
            {"role": "assistant", "content": "Hi there"},
        ]

        result = _filter_empty_content_messages(messages)

        assert result == messages

    def test_handles_empty_messages_list(self):
        """Given empty messages list, returns empty list."""
        messages = []

        result = _filter_empty_content_messages(messages)

        assert result == []

    def test_handles_mixed_content_types(self):
        """Given message with text and image blocks, filters only empty text."""
        messages = [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": ""},
                    {"type": "text", "text": "Description"},
                    {"type": "image_url", "image_url": {"url": "https://example.com/img.png"}},
                ],
            }
        ]

        result = _filter_empty_content_messages(messages)

        assert result == [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Description"},
                    {"type": "image_url", "image_url": {"url": "https://example.com/img.png"}},
                ],
            }
        ]


class TestTemplateAdapterEmptySystemMessage:
    """Tests for TemplateAdapter.format() empty system message handling."""

    def test_omits_system_message_when_instructions_empty(self):
        """Given empty instructions, system message is not included."""
        from unittest.mock import MagicMock
        from pydantic import Field

        adapter = TemplateAdapter()
        signature = MagicMock()
        signature._messages = Field(default=[{"role": "user", "content": "Hello"}])
        signature.instructions = ""
        signature.input_fields = {}
        signature.output_fields = {}

        # Mock _get_history_field_name to return None (no history)
        adapter._get_history_field_name = MagicMock(return_value=None)
        adapter.format_demos = MagicMock(return_value=[])

        result = adapter.format(signature, demos=[], inputs={})

        # System message should be omitted
        assert not any(msg.get("role") == "system" for msg in result)

    def test_omits_system_message_when_instructions_whitespace(self):
        """Given whitespace-only instructions, system message is not included."""
        from unittest.mock import MagicMock
        from pydantic import Field

        adapter = TemplateAdapter()
        signature = MagicMock()
        signature._messages = Field(default=[{"role": "user", "content": "Hello"}])
        signature.instructions = "   "
        signature.input_fields = {}
        signature.output_fields = {}

        adapter._get_history_field_name = MagicMock(return_value=None)
        adapter.format_demos = MagicMock(return_value=[])

        result = adapter.format(signature, demos=[], inputs={})

        assert not any(msg.get("role") == "system" for msg in result)

    def test_includes_system_message_when_instructions_non_empty(self):
        """Given non-empty instructions, system message is included."""
        from unittest.mock import MagicMock, patch
        from pydantic import Field

        adapter = TemplateAdapter()
        signature = MagicMock()
        signature._messages = Field(default=[{"role": "user", "content": "Hello"}])
        signature.instructions = "You are a helpful assistant"
        signature.input_fields = {}
        signature.output_fields = {}

        adapter._get_history_field_name = MagicMock(return_value=None)
        adapter.format_demos = MagicMock(return_value=[])

        # Mock split_message_content_for_custom_types to pass through
        with patch(
            "langwatch_nlp.studio.dspy.template_adapter.split_message_content_for_custom_types",
            side_effect=lambda x: x,
        ):
            result = adapter.format(signature, demos=[], inputs={})

        system_messages = [msg for msg in result if msg.get("role") == "system"]
        assert len(system_messages) == 1
        assert system_messages[0]["content"] == "You are a helpful assistant"


class TestTemplateAdapterLiquidRendering:
    """Tests for Liquid template rendering through TemplateAdapter.format()."""

    def _make_signature_with_messages(self, messages, instructions=""):
        """Create a mock signature with _messages and minimal fields."""
        from unittest.mock import MagicMock
        from pydantic import Field

        signature = MagicMock()
        signature._messages = Field(default=messages)
        signature.instructions = instructions
        signature.input_fields = {}
        signature.output_fields = {}
        return signature

    def test_renders_liquid_conditions_in_message_templates(self):
        """Given a message template with Liquid if/endif, renders based on inputs."""
        from unittest.mock import MagicMock, patch

        adapter = TemplateAdapter()
        template = "{% if context %}Use this context: {{ context }}{% endif %}Question: {{ question }}"
        signature = self._make_signature_with_messages(
            [{"role": "user", "content": template}]
        )
        adapter._get_history_field_name = MagicMock(return_value=None)
        adapter.format_demos = MagicMock(return_value=[])

        inputs = {"question": "What is AI?", "context": "AI is artificial intelligence"}

        with patch(
            "langwatch_nlp.studio.dspy.template_adapter.split_message_content_for_custom_types",
            side_effect=lambda x: x,
        ):
            result = adapter.format(signature, demos=[], inputs=inputs)

        # Find the user message (skip system if present)
        user_messages = [msg for msg in result if msg.get("role") == "user"]
        assert len(user_messages) == 1
        content = user_messages[0]["content"]
        assert "Use this context: AI is artificial intelligence" in content
        assert "Question: What is AI?" in content

    def test_renders_liquid_conditions_with_missing_optional_input(self):
        """Given a message template with Liquid if/endif and missing optional input, omits conditional block."""
        from unittest.mock import MagicMock, patch

        adapter = TemplateAdapter()
        template = "{% if context %}Use this context: {{ context }}{% endif %}Question: {{ question }}"
        signature = self._make_signature_with_messages(
            [{"role": "user", "content": template}]
        )
        adapter._get_history_field_name = MagicMock(return_value=None)
        adapter.format_demos = MagicMock(return_value=[])

        # context is not provided - should be treated as falsy
        inputs = {"question": "What is AI?"}

        with patch(
            "langwatch_nlp.studio.dspy.template_adapter.split_message_content_for_custom_types",
            side_effect=lambda x: x,
        ):
            result = adapter.format(signature, demos=[], inputs=inputs)

        user_messages = [msg for msg in result if msg.get("role") == "user"]
        assert len(user_messages) == 1
        content = user_messages[0]["content"]
        assert "Use this context" not in content
        assert "Question: What is AI?" in content
