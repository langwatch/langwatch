"""
Unit tests for parse_prompt_shorthand and SDK conflict validation in the Python SDK.

@see specs/prompts/shorthand-prompt-label-syntax.feature
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from unittest.mock import Mock
from langwatch.prompts.prompt_facade import parse_prompt_shorthand, PromptsFacade

pytestmark = pytest.mark.unit


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


class TestPromptsFacadeConflictValidation:
    """Tests for SDK-level conflict validation in PromptsFacade.get()."""

    @pytest.fixture
    def facade(self):
        mock_client = Mock()
        return PromptsFacade(rest_api_client=mock_client)

    def test_throws_when_shorthand_version_conflicts_with_explicit_version(self, facade):
        with pytest.raises(ValueError, match="Cannot combine shorthand with explicit version/label options"):
            facade.get("pizza-prompt:2", version_number=5)

    def test_throws_when_shorthand_label_conflicts_with_explicit_label(self, facade):
        with pytest.raises(ValueError, match="Cannot combine shorthand with explicit version/label options"):
            facade.get("pizza-prompt:production", label="staging")

    def test_throws_when_shorthand_version_conflicts_with_explicit_label(self, facade):
        with pytest.raises(ValueError, match="Cannot combine shorthand with explicit version/label options"):
            facade.get("pizza-prompt:2", label="production")

    def test_throws_when_both_explicit_version_and_label_provided(self, facade):
        with pytest.raises(ValueError, match="Cannot specify both version and label"):
            facade.get("pizza-prompt", version_number=5, label="production")
