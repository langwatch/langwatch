Feature: Reasoning Model LLM Configuration
  As a user running evaluations with reasoning models (GPT-5, o1, o3)
  I want the system to auto-correct invalid temperature and max_tokens values
  So that DSPy doesn't crash with "reasoning models require temperature=1.0"

  Background:
    Given reasoning models are identified by pattern "o1|o3|gpt-5" (case-insensitive)
    And reasoning models require temperature=1.0 and max_tokens >= 16000

  # Unit: Pure logic in utils.py

  @unit
  Scenario: Auto-correct temperature for reasoning model with invalid value
    Given an LLM config with model "openai/gpt-5"
    And temperature is 0.5
    When creating a DSPy LM instance
    Then temperature should be 1.0

  @unit
  Scenario: Auto-correct temperature for reasoning model with undefined value
    Given an LLM config with model "openai/gpt-5"
    And temperature is undefined
    When creating a DSPy LM instance
    Then temperature should be 1.0

  @unit
  Scenario: Auto-correct max_tokens for reasoning model below minimum
    Given an LLM config with model "openai/o1"
    And max_tokens is 2048
    When creating a DSPy LM instance
    Then max_tokens should be 16000

  @unit
  Scenario: Auto-correct max_tokens for reasoning model with undefined value
    Given an LLM config with model "openai/o3"
    And max_tokens is undefined
    When creating a DSPy LM instance
    Then max_tokens should be 16000

  @unit
  Scenario: Preserve valid config for reasoning model
    Given an LLM config with model "openai/gpt-5"
    And temperature is 1.0
    And max_tokens is 32000
    When creating a DSPy LM instance
    Then temperature should be 1.0
    And max_tokens should be 32000

  @unit
  Scenario: Non-reasoning model config unchanged
    Given an LLM config with model "openai/gpt-4o"
    And temperature is 0.5
    And max_tokens is 2048
    When creating a DSPy LM instance
    Then temperature should be 0.5
    And max_tokens should be 2048

  @unit
  Scenario: Non-reasoning model with undefined values uses defaults
    Given an LLM config with model "openai/gpt-4o"
    And temperature is undefined
    And max_tokens is undefined
    When creating a DSPy LM instance
    Then temperature should be 0
    And max_tokens should be 2048

  # Integration: Reasoning parameters passthrough

  @integration
  Scenario: reasoning_effort is passed to dspy.LM (OpenAI)
    Given an LLM config with model "openai/gpt-5" and reasoning_effort "high"
    When parsing a workflow with this config
    Then the generated dspy.LM should include reasoning_effort="high"

  @integration
  Scenario: thinkingLevel is passed to dspy.LM (Gemini)
    Given an LLM config with model "google/gemini-pro" and thinkingLevel "high"
    When parsing a workflow with this config
    Then the generated dspy.LM should include thinkingLevel="high"

  @integration
  Scenario: effort is passed to dspy.LM (Anthropic)
    Given an LLM config with model "anthropic/claude-3" and effort "high"
    When parsing a workflow with this config
    Then the generated dspy.LM should include effort="high"

  # Unified reasoning field mapping (canonical approach)
  # The 'reasoning' field is the canonical/unified field that gets mapped to provider-specific parameters

  @integration
  Scenario: Unified reasoning field maps to reasoning_effort for OpenAI
    Given an LLM config with model "openai/gpt-5" and reasoning "high"
    When parsing a workflow with this config
    Then the generated dspy.LM should include reasoning_effort="high"
    # Note: The unified 'reasoning' field is mapped to provider-specific parameters at the boundary

  @integration
  Scenario: Unified reasoning field maps to thinkingLevel for Gemini
    Given an LLM config with model "google/gemini-pro" and reasoning "high"
    When parsing a workflow with this config
    Then the generated dspy.LM should include thinkingLevel="high"

  @integration
  Scenario: Unified reasoning field maps to effort for Anthropic
    Given an LLM config with model "anthropic/claude-3" and reasoning "high"
    When parsing a workflow with this config
    Then the generated dspy.LM should include effort="high"

  # Backward compatibility with provider-specific fields in existing data
  @integration
  Scenario: Provider-specific reasoning_effort still works for backward compatibility
    Given an LLM config with model "openai/gpt-5" and reasoning_effort "high"
    When parsing a workflow with this config
    Then the generated dspy.LM should include reasoning_effort="high"
    # Note: Old data with provider-specific fields continues to work

  # Auto-correct max_tokens for models with reasoning enabled (non-OpenAI)
  # When effort/reasoning/thinkingLevel is set, LiteLLM may auto-enable extended thinking
  # with budget_tokens that can exceed max_tokens. We enforce min 16000 to prevent this.

  @unit
  Scenario: Auto-correct max_tokens for Anthropic model with effort enabled
    Given an LLM config with model "anthropic/claude-opus-4.5"
    And effort is "high"
    And max_tokens is 4096
    When creating a DSPy LM instance
    Then max_tokens should be 16000
    And temperature should be preserved (not forced to 1.0)

  @unit
  Scenario: Auto-correct max_tokens for model with unified reasoning field
    Given an LLM config with model "anthropic/claude-opus-4.5"
    And reasoning is "high"
    And max_tokens is 4096
    When creating a DSPy LM instance
    Then max_tokens should be 16000

  @unit
  Scenario: Auto-correct max_tokens for Gemini model with thinkingLevel enabled
    Given an LLM config with model "google/gemini-2.5-pro"
    And thinkingLevel is "high"
    And max_tokens is 4096
    When creating a DSPy LM instance
    Then max_tokens should be 16000

  @unit
  Scenario: Non-reasoning Anthropic model preserves user max_tokens
    Given an LLM config with model "anthropic/claude-sonnet-4"
    And effort is undefined
    And max_tokens is 4096
    When creating a DSPy LM instance
    Then max_tokens should be 4096

  @unit
  Scenario: Model with high max_tokens and reasoning preserves value
    Given an LLM config with model "anthropic/claude-opus-4.5"
    And effort is "high"
    And max_tokens is 32000
    When creating a DSPy LM instance
    Then max_tokens should be 32000
