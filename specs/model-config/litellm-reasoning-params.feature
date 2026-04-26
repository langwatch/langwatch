Feature: LiteLLM Reasoning Parameter Unification
  As a developer using LangWatch
  I want all reasoning parameters sent to LiteLLM as 'reasoning_effort'
  So that LiteLLM can transform them correctly for each provider's API

  Background:
    Given LiteLLM expects 'reasoning_effort' for ALL providers
    And LiteLLM internally transforms:
      | Provider  | Input               | Output                                    |
      | Anthropic | reasoning_effort    | output_config={"effort": ...} + beta header |
      | Gemini    | reasoning_effort    | thinking_level or thinking with budget    |
      | OpenAI    | reasoning_effort    | reasoning_effort (passed as-is)           |

  # Issue: LiteLLM rejects provider-specific params passed directly
  # Error: "effort: Extra inputs are not permitted"

    # NOT { effort: "high" } - LiteLLM doesn't recognize 'effort'

    # NOT { thinkingLevel: "medium" } - LiteLLM doesn't recognize 'thinkingLevel'

  @unit @unimplemented
  Scenario: Python boundary layer uses reasoning_effort for Anthropic
    Given an LLMConfig with model "anthropic/claude-opus-4.5" and reasoning "high"
    When calling node_llm_config_to_dspy_lm
    Then dspy.LM should be called with reasoning_effort="high"
    # NOT effort="high"

  @unit @unimplemented
  Scenario: Python boundary layer uses reasoning_effort for Gemini
    Given an LLMConfig with model "gemini/gemini-2.5-pro" and reasoning "medium"
    When calling node_llm_config_to_dspy_lm
    Then dspy.LM should be called with reasoning_effort="medium"
    # NOT thinkingLevel="medium"

  @unit @unimplemented
  Scenario: Jinja macro uses reasoning_effort for all providers
    Given a Jinja template rendering for model "anthropic/claude-opus-4.5" with reasoning "high"
    When the node_llm_config_to_dspy_lm macro is rendered
    Then the output should contain reasoning_effort="high"
    # NOT effort="high"

  # Translation layer: llmModels.json parameterName -> reasoning_effort
  # llmModels.json keeps provider-specific names for UI clarity
  # Translation happens at boundary before LiteLLM call

  # Normalization from database (backward compatibility)
  # Database may contain provider-specific fields from before unification
