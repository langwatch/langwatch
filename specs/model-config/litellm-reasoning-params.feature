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

  @unit
  Scenario: TypeScript boundary layer uses reasoning_effort for Anthropic
    Given a prompt config with model "anthropic/claude-opus-4.5" and reasoning "high"
    When mapping reasoning to provider parameters at the boundary
    Then the result should be { reasoning_effort: "high" }
    # NOT { effort: "high" } - LiteLLM doesn't recognize 'effort'

  @unit
  Scenario: TypeScript boundary layer uses reasoning_effort for Gemini
    Given a prompt config with model "gemini/gemini-2.5-pro" and reasoning "medium"
    When mapping reasoning to provider parameters at the boundary
    Then the result should be { reasoning_effort: "medium" }
    # NOT { thinkingLevel: "medium" } - LiteLLM doesn't recognize 'thinkingLevel'

  @unit
  Scenario: TypeScript boundary layer uses reasoning_effort for OpenAI
    Given a prompt config with model "openai/gpt-5" and reasoning "low"
    When mapping reasoning to provider parameters at the boundary
    Then the result should be { reasoning_effort: "low" }

  @unit
  Scenario: Python boundary layer uses reasoning_effort for Anthropic
    Given an LLMConfig with model "anthropic/claude-opus-4.5" and reasoning "high"
    When calling node_llm_config_to_dspy_lm
    Then dspy.LM should be called with reasoning_effort="high"
    # NOT effort="high"

  @unit
  Scenario: Python boundary layer uses reasoning_effort for Gemini
    Given an LLMConfig with model "gemini/gemini-2.5-pro" and reasoning "medium"
    When calling node_llm_config_to_dspy_lm
    Then dspy.LM should be called with reasoning_effort="medium"
    # NOT thinkingLevel="medium"

  @unit
  Scenario: Jinja macro uses reasoning_effort for all providers
    Given a Jinja template rendering for model "anthropic/claude-opus-4.5" with reasoning "high"
    When the node_llm_config_to_dspy_lm macro is rendered
    Then the output should contain reasoning_effort="high"
    # NOT effort="high"

  # Translation layer: llmModels.json parameterName -> reasoning_effort
  # llmModels.json keeps provider-specific names for UI clarity
  # Translation happens at boundary before LiteLLM call

  @unit
  Scenario: Translates registry parameterName 'effort' to reasoning_effort
    Given llmModels.json defines parameterName "effort" for Anthropic models
    When the reasoning value is mapped for LiteLLM
    Then the key should be translated to "reasoning_effort"

  @unit
  Scenario: Translates registry parameterName 'thinkingLevel' to reasoning_effort
    Given llmModels.json defines parameterName "thinkingLevel" for Gemini models
    When the reasoning value is mapped for LiteLLM
    Then the key should be translated to "reasoning_effort"

  @unit
  Scenario: Passes through reasoning_effort unchanged
    Given llmModels.json defines parameterName "reasoning_effort" for OpenAI models
    When the reasoning value is mapped for LiteLLM
    Then the key should remain "reasoning_effort"

  # Normalization from database (backward compatibility)
  # Database may contain provider-specific fields from before unification

  @unit
  Scenario: Normalizes effort from database to reasoning
    Given database config with effort "medium"
    When normalizing to unified format
    Then the result should have reasoning "medium"

  @unit
  Scenario: Normalizes thinkingLevel from database to reasoning
    Given database config with thinkingLevel "low"
    When normalizing to unified format
    Then the result should have reasoning "low"

  @unit
  Scenario: Priority order when multiple fields present
    Given database config with reasoning "high" and effort "low"
    When normalizing to unified format
    Then the result should have reasoning "high"
    # Priority: reasoning > reasoning_effort > thinkingLevel > effort
