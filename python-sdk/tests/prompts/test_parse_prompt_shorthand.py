"""
Unit tests for parse_prompt_shorthand in the Python SDK.

@see specs/prompts/shorthand-prompt-label-syntax.feature
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from langwatch.prompts.prompt_facade import parse_prompt_shorthand


class TestParsePromptShorthand:
    """Tests for parse_prompt_shorthand()."""

    def test_parses_label_shorthand(self):
        result = parse_prompt_shorthand("pizza-prompt:production")
        assert result == {"slug": "pizza-prompt", "label": "production", "version": None}

    def test_parses_version_shorthand(self):
        result = parse_prompt_shorthand("pizza-prompt:2")
        assert result == {"slug": "pizza-prompt", "label": None, "version": 2}

    def test_parses_bare_slug(self):
        result = parse_prompt_shorthand("pizza-prompt")
        assert result == {"slug": "pizza-prompt", "label": None, "version": None}

    def test_treats_latest_as_noop(self):
        result = parse_prompt_shorthand("pizza-prompt:latest")
        assert result == {"slug": "pizza-prompt", "label": None, "version": None}

    def test_preserves_slug_with_slash(self):
        result = parse_prompt_shorthand("my-org/prompt:staging")
        assert result == {"slug": "my-org/prompt", "label": "staging", "version": None}

    def test_rejects_empty_slug(self):
        with pytest.raises(ValueError, match="slug must not be empty"):
            parse_prompt_shorthand(":production")

    def test_treats_zero_as_label(self):
        result = parse_prompt_shorthand("pizza-prompt:0")
        assert result == {"slug": "pizza-prompt", "label": "0", "version": None}

    def test_treats_negative_as_label(self):
        result = parse_prompt_shorthand("pizza-prompt:-1")
        assert result == {"slug": "pizza-prompt", "label": "-1", "version": None}

    def test_treats_float_as_label(self):
        result = parse_prompt_shorthand("pizza-prompt:1.5")
        assert result == {"slug": "pizza-prompt", "label": "1.5", "version": None}
