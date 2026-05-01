Feature: LiteLLM Model ID Translation
  As a developer using LangWatch with Anthropic models
  I want model IDs translated to LiteLLM-compatible format at the boundary
  So that API calls work without modifying the source of truth (llmModels.json)

  Background:
    Given llmModels.json is the immutable source of truth for model definitions
    And llmModels.json uses dot notation for versions (e.g., "anthropic/claude-opus-4.5")
    And LiteLLM expects dash notation for versions (e.g., "anthropic/claude-opus-4-5")
    And we CANNOT modify llmModels.json

  # Design: Runtime dot-to-dash conversion at the API boundary
  #
  # Architecture:
  # - translateModelIdForLitellm(): converts dots to dashes in version numbers
  # - Only applies to Anthropic models (other providers use their IDs as-is)
  # - Called in prepareLitellmParams() before sending to LiteLLM
  #
  # Pattern: "X.Y" → "X-Y" in model name portion
  # Example: "anthropic/claude-opus-4.5" → "anthropic/claude-opus-4-5"

  # Unit Tests: Translation Function

    # LiteLLM requires the full dated version for Claude 3.5 Haiku

  @unit @unimplemented
  Scenario: Translates Anthropic Claude 3.5 Sonnet model ID
    Given a model ID "anthropic/claude-3.5-sonnet"
    When calling translateModelIdForLitellm
    Then the result should be "anthropic/claude-3-5-sonnet"

    # Gemini uses dashes natively, no conversion needed

    # Models already using dashes pass through unchanged

    # All dots in version numbers are converted

    # Translation applies regardless of prefix

  # Unit Tests: Model Alias Mapping
  # Some models require alias expansion to their full dated versions
  # Example: "anthropic/claude-sonnet-4" → "anthropic/claude-sonnet-4-20250514"

    # LiteLLM requires the full dated version for Claude 4 models

    # LiteLLM requires the full dated version for Claude 4 models

  # Unit Tests: Boundary Integration

  @unit @unimplemented
  Scenario: prepareLitellmParams translates Anthropic model ID
    Given a call to prepareLitellmParams with model "anthropic/claude-opus-4.5"
    And a valid Anthropic model provider
    When the function returns
    Then params.model should be "anthropic/claude-opus-4-5"

  @unit @unimplemented
  Scenario: prepareLitellmParams preserves OpenAI model ID
    Given a call to prepareLitellmParams with model "openai/gpt-5"
    And a valid OpenAI model provider
    When the function returns
    Then params.model should be "openai/gpt-5"

  # Integration Tests: Actual API Calls

  @integration @unimplemented
  Scenario: Anthropic API call succeeds with translated model ID
    Given valid Anthropic API credentials in environment
    And a simple prompt "Say hello in exactly one word"
    When calling the Anthropic API through LiteLLM with model "anthropic/claude-3.5-haiku"
    Then the API call should succeed
    And the response should contain text

  @integration @unimplemented
  Scenario: End-to-end prompt execution with Anthropic Claude 3.5 Haiku
    Given a prompt configured with model "anthropic/claude-3.5-haiku"
    And valid Anthropic API credentials
    When executing the prompt through the playground
    Then the execution should succeed
    And no "model not found" error should occur
