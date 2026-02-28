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
from langwatch_nlp.studio.utils import (
    clamp_to_provider_constraints,
    get_provider_from_model_id,
    node_llm_config_to_dspy_lm,
    translate_model_id_for_litellm,
)


class TestReasoningModelConfig:
    """Tests for reasoning model (GPT-5, o1, o3) LLM configuration."""

    @pytest.fixture
    def mock_dspy_lm(self):
        """Mock dspy.LM to capture arguments without actual initialization."""
        with patch("langwatch_nlp.studio.utils.dspy.LM") as mock:
            mock.return_value = MagicMock()
            yield mock

    # Reasoning models: temperature must be 1.0 (required by DSPy)

    def test_sets_temperature_1_for_gpt5(self, mock_dspy_lm):
        """Given gpt-5, temperature should be set to 1.0 (required by DSPy)."""
        config = LLMConfig(model="openai/gpt-5", temperature=0.5, max_tokens=16000)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("temperature") == 1.0

    def test_sets_temperature_1_for_o1(self, mock_dspy_lm):
        """Given o1, temperature should be set to 1.0 (required by DSPy)."""
        config = LLMConfig(model="openai/o1", temperature=0, max_tokens=16000)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("temperature") == 1.0

    def test_sets_temperature_1_for_o3(self, mock_dspy_lm):
        """Given o3, temperature should be set to 1.0 (required by DSPy)."""
        config = LLMConfig(model="openai/o3", temperature=0.7, max_tokens=16000)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("temperature") == 1.0

    # Auto-correct max_tokens for reasoning models

    def test_autocorrect_max_tokens_for_reasoning_model_below_minimum(
        self, mock_dspy_lm
    ):
        """Given max_tokens=2048 for o1, should auto-correct to 16000."""
        config = LLMConfig(model="openai/o1", temperature=1.0, max_tokens=2048)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("max_tokens") == 16000

    def test_autocorrect_max_tokens_for_reasoning_model_with_undefined_value(
        self, mock_dspy_lm
    ):
        """Given max_tokens=None for o3, should auto-correct to 16000."""
        config = LLMConfig(model="openai/o3", temperature=1.0, max_tokens=None)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("max_tokens") == 16000

    # Preserve valid max_tokens for reasoning models

    def test_preserve_high_max_tokens_for_reasoning_model(self, mock_dspy_lm):
        """Given max_tokens=32000 for gpt-5, should preserve (above minimum)."""
        config = LLMConfig(model="openai/gpt-5", temperature=0.5, max_tokens=32000)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("temperature") == 1.0
        assert call_kwargs.get("max_tokens") == 32000

    # Non-reasoning models unchanged

    def test_non_reasoning_model_config_unchanged(self, mock_dspy_lm):
        """Given gpt-4o with temperature=0.5 and max_tokens=2048, should preserve."""
        config = LLMConfig(model="openai/gpt-4o", temperature=0.5, max_tokens=2048)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("temperature") == 0.5
        assert call_kwargs.get("max_tokens") == 2048

    def test_non_reasoning_model_with_undefined_values_uses_defaults(
        self, mock_dspy_lm
    ):
        """Given gpt-4o with undefined values, should use UI defaults (1, 4096)."""
        config = LLMConfig(model="openai/gpt-4o", temperature=None, max_tokens=None)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        # Defaults match UI parameterRegistry defaults
        assert call_kwargs.get("temperature") == 1
        assert call_kwargs.get("max_tokens") == 4096

    # False positive prevention - models containing o1/o3 substrings

    def test_model_containing_o3_substring_not_treated_as_reasoning(self, mock_dspy_lm):
        """Given 'demo3' model, should NOT be treated as reasoning model."""
        config = LLMConfig(model="openai/demo3", temperature=0.5, max_tokens=2048)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("temperature") == 0.5

    def test_model_containing_o1_substring_not_treated_as_reasoning(self, mock_dspy_lm):
        """Given 'pro1' model, should NOT be treated as reasoning model."""
        config = LLMConfig(model="openai/pro1", temperature=0.5, max_tokens=2048)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("temperature") == 0.5

    def test_o1_mini_variant_treated_as_reasoning(self, mock_dspy_lm):
        """Given 'o1-mini' model, should be treated as reasoning model."""
        config = LLMConfig(model="openai/o1-mini", temperature=0.5, max_tokens=2048)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("temperature") == 1.0

    # Auto-correct max_tokens for models with reasoning enabled (non-OpenAI)
    # When effort/reasoning/thinkingLevel is set, LiteLLM may auto-enable extended
    # thinking with budget_tokens that can exceed max_tokens.

    def test_autocorrect_max_tokens_for_anthropic_with_effort(self, mock_dspy_lm):
        """Given effort='high' for claude-opus-4.5, auto-corrects max_tokens to 16000."""
        config = LLMConfig(
            model="anthropic/claude-opus-4.5", effort="high", max_tokens=4096
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("max_tokens") == 16000

    def test_anthropic_with_effort_preserves_temperature(self, mock_dspy_lm):
        """Given effort='high' for Anthropic, temperature is NOT forced to 1.0."""
        config = LLMConfig(
            model="anthropic/claude-opus-4.5", effort="high", temperature=0.7
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        # Temperature should be preserved (clamped to 1.0 max for Anthropic)
        assert call_kwargs.get("temperature") == 0.7

    def test_autocorrect_max_tokens_for_model_with_unified_reasoning(self, mock_dspy_lm):
        """Given reasoning='high' for any model, auto-corrects max_tokens to 16000."""
        config = LLMConfig(
            model="anthropic/claude-opus-4.5", reasoning="high", max_tokens=4096
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("max_tokens") == 16000

    def test_autocorrect_max_tokens_for_gemini_with_thinkinglevel(self, mock_dspy_lm):
        """Given thinkingLevel='high' for Gemini, auto-corrects max_tokens to 16000."""
        config = LLMConfig(
            model="google/gemini-2.5-pro", thinkingLevel="high", max_tokens=4096
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("max_tokens") == 16000

    def test_non_reasoning_anthropic_preserves_max_tokens(self, mock_dspy_lm):
        """Given Anthropic model without reasoning, max_tokens is preserved."""
        config = LLMConfig(
            model="anthropic/claude-sonnet-4", max_tokens=4096
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("max_tokens") == 4096

    def test_model_with_high_max_tokens_and_reasoning_preserves_value(self, mock_dspy_lm):
        """Given max_tokens=32000 with effort='high', value is preserved (above minimum)."""
        config = LLMConfig(
            model="anthropic/claude-opus-4.5", effort="high", max_tokens=32000
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("max_tokens") == 32000

    # Reasoning parameters passthrough

    def test_reasoning_effort_passed_to_dspy_lm(self, mock_dspy_lm):
        """Given reasoning_effort='high', it should be passed to dspy.LM."""
        config = LLMConfig(
            model="openai/gpt-5",
            reasoning_effort="high",
            max_tokens=16000,
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("reasoning_effort") == "high"

    def test_thinkingLevel_translated_to_reasoning_effort(self, mock_dspy_lm):
        """Given thinkingLevel='high' (Gemini), it should be translated to reasoning_effort for LiteLLM."""
        config = LLMConfig(
            model="google/gemini-pro",
            thinkingLevel="high",
            max_tokens=4096,
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        # LiteLLM expects reasoning_effort for all providers
        assert call_kwargs.get("reasoning_effort") == "high"
        assert "thinkingLevel" not in call_kwargs

    def test_effort_translated_to_reasoning_effort(self, mock_dspy_lm):
        """Given effort='high' (Anthropic), it should be translated to reasoning_effort for LiteLLM."""
        config = LLMConfig(
            model="anthropic/claude-3",
            effort="high",
            max_tokens=4096,
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        # LiteLLM expects reasoning_effort for all providers
        assert call_kwargs.get("reasoning_effort") == "high"
        assert "effort" not in call_kwargs

    def test_unified_reasoning_maps_to_provider_specific_param(self, mock_dspy_lm):
        """Given unified 'reasoning' field (canonical), it should map to provider-specific param."""
        config = LLMConfig(
            model="openai/gpt-5",
            reasoning="medium",  # Canonical unified field
            max_tokens=16000,
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        # Should be mapped to provider-specific param (reasoning_effort for OpenAI)
        assert call_kwargs.get("reasoning_effort") == "medium"
        assert "reasoning" not in call_kwargs

    def test_reasoning_takes_precedence_over_reasoning_effort(self, mock_dspy_lm):
        """The unified 'reasoning' field is canonical and takes priority."""
        config = LLMConfig(
            model="openai/gpt-5",
            reasoning="low",
            reasoning_effort="high",
            max_tokens=16000,
        )
        node_llm_config_to_dspy_lm(config)
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("reasoning_effort") == "low"


class TestLiteLLMReasoningParameterUnification:
    """Tests for LiteLLM reasoning parameter unification.

    LiteLLM expects 'reasoning_effort' for ALL providers and transforms internally:
    - Anthropic: reasoning_effort -> output_config={"effort": ...} + beta header
    - Gemini: reasoning_effort -> thinking_level or thinking with budget
    - OpenAI: reasoning_effort -> passed as-is

    This test class verifies that all provider-specific params are translated to
    reasoning_effort at the boundary before calling LiteLLM.
    """

    @pytest.fixture
    def mock_dspy_lm(self):
        """Mock dspy.LM to capture arguments without actual initialization."""
        with patch("langwatch_nlp.studio.utils.dspy.LM") as mock:
            mock.return_value = MagicMock()
            yield mock

    def test_anthropic_reasoning_uses_reasoning_effort(self, mock_dspy_lm):
        """Given Anthropic model with reasoning='high', dspy.LM receives reasoning_effort='high'."""
        config = LLMConfig(
            model="anthropic/claude-opus-4.5",
            reasoning="high",
            max_tokens=4096,
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("reasoning_effort") == "high"
        assert "effort" not in call_kwargs

    def test_gemini_reasoning_uses_reasoning_effort(self, mock_dspy_lm):
        """Given Gemini model with reasoning='medium', dspy.LM receives reasoning_effort='medium'."""
        config = LLMConfig(
            model="gemini/gemini-2.5-pro",
            reasoning="medium",
            max_tokens=4096,
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("reasoning_effort") == "medium"
        assert "thinkingLevel" not in call_kwargs

    def test_openai_reasoning_uses_reasoning_effort(self, mock_dspy_lm):
        """Given OpenAI model with reasoning='low', dspy.LM receives reasoning_effort='low'."""
        config = LLMConfig(
            model="openai/gpt-5",
            reasoning="low",
            max_tokens=16000,
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("reasoning_effort") == "low"

    def test_no_reasoning_param_when_not_set(self, mock_dspy_lm):
        """Given no reasoning value, no reasoning param should be passed."""
        config = LLMConfig(
            model="openai/gpt-4o",
            max_tokens=4096,
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert "reasoning_effort" not in call_kwargs
        assert "effort" not in call_kwargs
        assert "thinkingLevel" not in call_kwargs


class TestSamplingParametersPassthrough:
    """Tests for sampling parameters being passed to DSPy."""

    @pytest.fixture
    def mock_dspy_lm(self):
        """Mock dspy.LM to capture arguments without actual initialization."""
        with patch("langwatch_nlp.studio.utils.dspy.LM") as mock:
            mock.return_value = MagicMock()
            yield mock

    def test_top_p_passed_to_dspy_lm(self, mock_dspy_lm):
        """Given top_p=0.9, it should be passed to dspy.LM."""
        config = LLMConfig(model="openai/gpt-4o", temperature=0.5, top_p=0.9)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("top_p") == 0.9

    def test_frequency_penalty_passed_to_dspy_lm(self, mock_dspy_lm):
        """Given frequency_penalty=0.5, it should be passed to dspy.LM."""
        config = LLMConfig(model="openai/gpt-4o", temperature=0.5, frequency_penalty=0.5)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("frequency_penalty") == 0.5

    def test_presence_penalty_passed_to_dspy_lm(self, mock_dspy_lm):
        """Given presence_penalty=0.7, it should be passed to dspy.LM."""
        config = LLMConfig(model="openai/gpt-4o", temperature=0.5, presence_penalty=0.7)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("presence_penalty") == 0.7

    def test_seed_passed_to_dspy_lm(self, mock_dspy_lm):
        """Given seed=12345, it should be passed to dspy.LM."""
        config = LLMConfig(model="openai/gpt-4o", temperature=0.5, seed=12345)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("seed") == 12345

    def test_top_k_passed_to_dspy_lm(self, mock_dspy_lm):
        """Given top_k=50, it should be passed to dspy.LM."""
        config = LLMConfig(model="openai/gpt-4o", temperature=0.5, top_k=50)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("top_k") == 50

    def test_min_p_passed_to_dspy_lm(self, mock_dspy_lm):
        """Given min_p=0.1, it should be passed to dspy.LM."""
        config = LLMConfig(model="openai/gpt-4o", temperature=0.5, min_p=0.1)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("min_p") == 0.1

    def test_repetition_penalty_passed_to_dspy_lm(self, mock_dspy_lm):
        """Given repetition_penalty=1.2, it should be passed to dspy.LM."""
        config = LLMConfig(model="openai/gpt-4o", temperature=0.5, repetition_penalty=1.2)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("repetition_penalty") == 1.2

    def test_none_sampling_params_not_passed(self, mock_dspy_lm):
        """Given None sampling params, they should not be included in kwargs."""
        config = LLMConfig(model="openai/gpt-4o", temperature=0.5, top_p=None, seed=None)

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert "top_p" not in call_kwargs
        assert "seed" not in call_kwargs

    def test_multiple_sampling_params_passed_together(self, mock_dspy_lm):
        """Given multiple sampling params, all should be passed to dspy.LM."""
        config = LLMConfig(
            model="openai/gpt-4o",
            temperature=0.5,
            top_p=0.9,
            frequency_penalty=0.5,
            presence_penalty=0.3,
            seed=42,
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("top_p") == 0.9
        assert call_kwargs.get("frequency_penalty") == 0.5
        assert call_kwargs.get("presence_penalty") == 0.3
        assert call_kwargs.get("seed") == 42


class TestTranslateModelIdForLitellm:
    """Tests for model ID translation at the LiteLLM boundary.

    LiteLLM expects model IDs with dashes but llmModels.json uses dots.
    This tests the runtime dot-to-dash conversion.
    """

    def test_translates_anthropic_claude_opus_4_5(self):
        """Translates anthropic/claude-opus-4.5 to anthropic/claude-opus-4-5."""
        result = translate_model_id_for_litellm("anthropic/claude-opus-4.5")
        assert result == "anthropic/claude-opus-4-5"

    def test_translates_anthropic_claude_sonnet_4_5(self):
        """Translates anthropic/claude-sonnet-4.5 to anthropic/claude-sonnet-4-5."""
        result = translate_model_id_for_litellm("anthropic/claude-sonnet-4.5")
        assert result == "anthropic/claude-sonnet-4-5"

    def test_translates_anthropic_claude_3_5_haiku(self):
        """Translates anthropic/claude-3.5-haiku to anthropic/claude-3-5-haiku-20241022 (alias expansion)."""
        result = translate_model_id_for_litellm("anthropic/claude-3.5-haiku")
        assert result == "anthropic/claude-3-5-haiku-20241022"

    def test_translates_anthropic_claude_3_7_sonnet(self):
        """Translates anthropic/claude-3.7-sonnet to anthropic/claude-3-7-sonnet."""
        result = translate_model_id_for_litellm("anthropic/claude-3.7-sonnet")
        assert result == "anthropic/claude-3-7-sonnet"

    def test_translates_anthropic_claude_3_5_sonnet(self):
        """Translates anthropic/claude-3.5-sonnet to anthropic/claude-3-5-sonnet-20240620 (alias expansion)."""
        result = translate_model_id_for_litellm("anthropic/claude-3.5-sonnet")
        assert result == "anthropic/claude-3-5-sonnet-20240620"

    def test_preserves_openai_gpt_5(self):
        """Preserves openai/gpt-5 unchanged."""
        result = translate_model_id_for_litellm("openai/gpt-5")
        assert result == "openai/gpt-5"

    def test_preserves_gemini_2_5_pro(self):
        """Preserves gemini/gemini-2.5-pro unchanged (Gemini uses dots intentionally)."""
        result = translate_model_id_for_litellm("gemini/gemini-2.5-pro")
        assert result == "gemini/gemini-2.5-pro"

    def test_preserves_anthropic_without_dots(self):
        """Preserves anthropic/claude-3-opus unchanged (no dots to convert)."""
        result = translate_model_id_for_litellm("anthropic/claude-3-opus")
        assert result == "anthropic/claude-3-opus"

    def test_converts_multiple_dots(self):
        """Converts all dots in anthropic/claude-opus-4.5.1 to dashes."""
        result = translate_model_id_for_litellm("anthropic/claude-opus-4.5.1")
        assert result == "anthropic/claude-opus-4-5-1"

    def test_translates_custom_prefix(self):
        """Translates custom/claude-opus-4.5 to custom/claude-opus-4-5."""
        result = translate_model_id_for_litellm("custom/claude-opus-4.5")
        assert result == "custom/claude-opus-4-5"

    def test_handles_empty_string(self):
        """Handles empty string input."""
        result = translate_model_id_for_litellm("")
        assert result == ""

    def test_handles_none_input(self):
        """Handles None input."""
        result = translate_model_id_for_litellm(None)
        assert result is None

    def test_handles_model_without_prefix(self):
        """Handles model without provider prefix."""
        result = translate_model_id_for_litellm("claude-3.5-sonnet")
        assert result == "claude-3-5-sonnet"

    def test_translates_claude_sonnet_4_alias(self):
        """Translates anthropic/claude-sonnet-4 to anthropic/claude-sonnet-4-20250514."""
        result = translate_model_id_for_litellm("anthropic/claude-sonnet-4")
        assert result == "anthropic/claude-sonnet-4-20250514"

    def test_translates_claude_opus_4_alias(self):
        """Translates anthropic/claude-opus-4 to anthropic/claude-opus-4-20250514."""
        result = translate_model_id_for_litellm("anthropic/claude-opus-4")
        assert result == "anthropic/claude-opus-4-20250514"


class TestModelIdTranslationInDspyLm:
    """Tests that model ID translation is applied in node_llm_config_to_dspy_lm."""

    @pytest.fixture
    def mock_dspy_lm(self):
        """Mock dspy.LM to capture arguments without actual initialization."""
        with patch("langwatch_nlp.studio.utils.dspy.LM") as mock:
            mock.return_value = MagicMock()
            yield mock

    def test_anthropic_model_id_translated_in_dspy_lm(self, mock_dspy_lm):
        """Given anthropic/claude-opus-4.5, dspy.LM receives anthropic/claude-opus-4-5."""
        config = LLMConfig(
            model="anthropic/claude-opus-4.5",
            max_tokens=4096,
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("model") == "anthropic/claude-opus-4-5"

    def test_openai_model_id_preserved_in_dspy_lm(self, mock_dspy_lm):
        """Given openai/gpt-5, dspy.LM receives openai/gpt-5 (unchanged)."""
        config = LLMConfig(
            model="openai/gpt-5",
            max_tokens=16000,
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("model") == "openai/gpt-5"

    def test_gemini_model_id_preserved_in_dspy_lm(self, mock_dspy_lm):
        """Given gemini/gemini-2.5-pro, dspy.LM receives gemini/gemini-2.5-pro (unchanged)."""
        config = LLMConfig(
            model="gemini/gemini-2.5-pro",
            max_tokens=4096,
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("model") == "gemini/gemini-2.5-pro"

    def test_litellm_params_model_translated(self, mock_dspy_lm):
        """Given litellm_params with anthropic model, the model is translated."""
        config = LLMConfig(
            model="anthropic/claude-3.5-haiku",
            litellm_params={"model": "anthropic/claude-3.5-haiku", "api_key": "test"},
            max_tokens=4096,
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("model") == "anthropic/claude-3-5-haiku-20241022"


class TestGetProviderFromModelId:
    """Tests for extracting provider from model ID."""

    def test_extracts_anthropic_provider(self):
        """Extracts 'anthropic' from anthropic/claude-sonnet-4."""
        result = get_provider_from_model_id("anthropic/claude-sonnet-4")
        assert result == "anthropic"

    def test_extracts_openai_provider(self):
        """Extracts 'openai' from openai/gpt-4.1."""
        result = get_provider_from_model_id("openai/gpt-4.1")
        assert result == "openai"

    def test_returns_none_for_model_without_slash(self):
        """Returns None for standalone-model (no provider prefix)."""
        result = get_provider_from_model_id("standalone-model")
        assert result is None

    def test_returns_none_for_empty_string(self):
        """Returns None for empty string."""
        result = get_provider_from_model_id("")
        assert result is None

    def test_returns_none_for_none(self):
        """Returns None for None input."""
        result = get_provider_from_model_id(None)
        assert result is None


class TestClampToProviderConstraints:
    """Tests for clamping parameter values to provider constraints."""

    def test_clamps_temperature_above_anthropic_max(self):
        """Clamps temperature 1.5 to 1.0 for Anthropic."""
        result = clamp_to_provider_constraints(
            value=1.5,
            param_name="temperature",
            model_id="anthropic/claude-sonnet-4",
        )
        assert result == 1.0

    def test_clamps_temperature_below_anthropic_min(self):
        """Clamps temperature -0.5 to 0 for Anthropic."""
        result = clamp_to_provider_constraints(
            value=-0.5,
            param_name="temperature",
            model_id="anthropic/claude-sonnet-4",
        )
        assert result == 0

    def test_preserves_temperature_within_anthropic_range(self):
        """Preserves temperature 0.7 for Anthropic (within 0-1 range)."""
        result = clamp_to_provider_constraints(
            value=0.7,
            param_name="temperature",
            model_id="anthropic/claude-sonnet-4",
        )
        assert result == 0.7

    def test_preserves_anthropic_min_boundary(self):
        """Preserves temperature 0 for Anthropic (at min boundary)."""
        result = clamp_to_provider_constraints(
            value=0,
            param_name="temperature",
            model_id="anthropic/claude-sonnet-4",
        )
        assert result == 0

    def test_preserves_anthropic_max_boundary(self):
        """Preserves temperature 1.0 for Anthropic (at max boundary)."""
        result = clamp_to_provider_constraints(
            value=1.0,
            param_name="temperature",
            model_id="anthropic/claude-sonnet-4",
        )
        assert result == 1.0

    def test_openai_no_constraints_preserves_value(self):
        """Preserves temperature 1.8 for OpenAI (no constraints defined)."""
        result = clamp_to_provider_constraints(
            value=1.8,
            param_name="temperature",
            model_id="openai/gpt-4.1",
        )
        assert result == 1.8

    def test_unknown_provider_preserves_value(self):
        """Preserves value for unknown provider."""
        result = clamp_to_provider_constraints(
            value=2.5,
            param_name="temperature",
            model_id="unknown/some-model",
        )
        assert result == 2.5

    def test_model_without_provider_preserves_value(self):
        """Preserves value for model without provider prefix."""
        result = clamp_to_provider_constraints(
            value=1.5,
            param_name="temperature",
            model_id="standalone-model",
        )
        assert result == 1.5

    def test_none_model_id_preserves_value(self):
        """Preserves value when model_id is None."""
        result = clamp_to_provider_constraints(
            value=1.5,
            param_name="temperature",
            model_id=None,
        )
        assert result == 1.5

    def test_unknown_param_preserves_value(self):
        """Preserves value for unknown parameter name."""
        result = clamp_to_provider_constraints(
            value=5.0,
            param_name="unknown_param",
            model_id="anthropic/claude-sonnet-4",
        )
        assert result == 5.0


class TestAnthropicTemperatureClampingInDspyLm:
    """Tests that Anthropic temperature clamping is applied in node_llm_config_to_dspy_lm."""

    @pytest.fixture
    def mock_dspy_lm(self):
        """Mock dspy.LM to capture arguments without actual initialization."""
        with patch("langwatch_nlp.studio.utils.dspy.LM") as mock:
            mock.return_value = MagicMock()
            yield mock

    def test_anthropic_temperature_clamped_to_1(self, mock_dspy_lm):
        """Given Anthropic model with temperature=1.5, dspy.LM receives temperature=1.0."""
        config = LLMConfig(
            model="anthropic/claude-sonnet-4",
            temperature=1.5,
            max_tokens=4096,
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("temperature") == 1.0

    def test_anthropic_temperature_within_range_preserved(self, mock_dspy_lm):
        """Given Anthropic model with temperature=0.7, dspy.LM receives temperature=0.7."""
        config = LLMConfig(
            model="anthropic/claude-sonnet-4",
            temperature=0.7,
            max_tokens=4096,
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("temperature") == 0.7

    def test_openai_temperature_not_clamped(self, mock_dspy_lm):
        """Given OpenAI model with temperature=1.8, dspy.LM receives temperature=1.8."""
        config = LLMConfig(
            model="openai/gpt-4o",
            temperature=1.8,
            max_tokens=4096,
        )

        node_llm_config_to_dspy_lm(config)

        mock_dspy_lm.assert_called_once()
        call_kwargs = mock_dspy_lm.call_args.kwargs
        assert call_kwargs.get("temperature") == 1.8
