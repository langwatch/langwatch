"""
Unit tests for reasoning model LLM configuration auto-correction.

Tests the node_llm_config_to_dspy_lm function to ensure it auto-corrects
invalid temperature and max_tokens values for reasoning models (GPT-5, o1, o3).

Regression test for: "OpenAI's reasoning models require temperature=1.0 or None
and max_tokens >= 16000"
"""

import pytest
from unittest.mock import patch, MagicMock
from langwatch_nlp.studio.types.dsl import LLMConfig
from langwatch_nlp.studio.utils import node_llm_config_to_dspy_lm


class TestReasoningModelConfig:
    """Tests for reasoning model (GPT-5, o1, o3) LLM configuration."""

    @pytest.fixture
    def mock_dspy_lm(self):
        """Mock dspy.LM to capture arguments without actual initialization."""
        with patch("langwatch_nlp.studio.utils.dspy.LM") as mock:
            mock.return_value = MagicMock()
            yield mock

    # Auto-correct temperature for reasoning models

    def test_autocorrect_temperature_for_gpt5_with_invalid_value(self, mock_dspy_lm):
        """Given temperature=0.5 for gpt-5, should auto-correct to 1.0."""
        config = LLMConfig(model="openai/gpt-5", temperature=0.5, max_tokens=16000)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args
        assert (
            call_kwargs.kwargs.get("temperature") == 1.0
            or call_kwargs[1].get("temperature") == 1.0
        )

    def test_autocorrect_temperature_for_gpt5_with_undefined_value(self, mock_dspy_lm):
        """Given temperature=None for gpt-5, should auto-correct to 1.0."""
        config = LLMConfig(model="openai/gpt-5", temperature=None, max_tokens=16000)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args
        assert (
            call_kwargs.kwargs.get("temperature") == 1.0
            or call_kwargs[1].get("temperature") == 1.0
        )

    def test_autocorrect_temperature_for_o1_model(self, mock_dspy_lm):
        """Given temperature=0 for o1, should auto-correct to 1.0."""
        config = LLMConfig(model="openai/o1", temperature=0, max_tokens=16000)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args
        assert (
            call_kwargs.kwargs.get("temperature") == 1.0
            or call_kwargs[1].get("temperature") == 1.0
        )

    def test_autocorrect_temperature_for_o3_model(self, mock_dspy_lm):
        """Given temperature=0.7 for o3, should auto-correct to 1.0."""
        config = LLMConfig(model="openai/o3", temperature=0.7, max_tokens=16000)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args
        assert (
            call_kwargs.kwargs.get("temperature") == 1.0
            or call_kwargs[1].get("temperature") == 1.0
        )

    # Auto-correct max_tokens for reasoning models

    def test_autocorrect_max_tokens_for_reasoning_model_below_minimum(
        self, mock_dspy_lm
    ):
        """Given max_tokens=2048 for o1, should auto-correct to 16000."""
        config = LLMConfig(model="openai/o1", temperature=1.0, max_tokens=2048)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args
        assert (
            call_kwargs.kwargs.get("max_tokens") == 16000
            or call_kwargs[1].get("max_tokens") == 16000
        )

    def test_autocorrect_max_tokens_for_reasoning_model_with_undefined_value(
        self, mock_dspy_lm
    ):
        """Given max_tokens=None for o3, should auto-correct to 16000."""
        config = LLMConfig(model="openai/o3", temperature=1.0, max_tokens=None)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args
        assert (
            call_kwargs.kwargs.get("max_tokens") == 16000
            or call_kwargs[1].get("max_tokens") == 16000
        )

    # Preserve valid config for reasoning models

    def test_preserve_valid_config_for_reasoning_model(self, mock_dspy_lm):
        """Given valid temperature=1.0 and max_tokens=32000 for gpt-5, should preserve."""
        config = LLMConfig(model="openai/gpt-5", temperature=1.0, max_tokens=32000)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args
        assert (
            call_kwargs.kwargs.get("temperature") == 1.0
            or call_kwargs[1].get("temperature") == 1.0
        )
        assert (
            call_kwargs.kwargs.get("max_tokens") == 32000
            or call_kwargs[1].get("max_tokens") == 32000
        )

    # Non-reasoning models unchanged

    def test_non_reasoning_model_config_unchanged(self, mock_dspy_lm):
        """Given gpt-4o with temperature=0.5 and max_tokens=2048, should preserve."""
        config = LLMConfig(model="openai/gpt-4o", temperature=0.5, max_tokens=2048)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args
        assert (
            call_kwargs.kwargs.get("temperature") == 0.5
            or call_kwargs[1].get("temperature") == 0.5
        )
        assert (
            call_kwargs.kwargs.get("max_tokens") == 2048
            or call_kwargs[1].get("max_tokens") == 2048
        )

    def test_non_reasoning_model_with_undefined_values_uses_defaults(
        self, mock_dspy_lm
    ):
        """Given gpt-4o with undefined values, should use defaults (0, 2048)."""
        config = LLMConfig(model="openai/gpt-4o", temperature=None, max_tokens=None)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args
        assert (
            call_kwargs.kwargs.get("temperature") == 0
            or call_kwargs[1].get("temperature") == 0
        )
        assert (
            call_kwargs.kwargs.get("max_tokens") == 2048
            or call_kwargs[1].get("max_tokens") == 2048
        )
