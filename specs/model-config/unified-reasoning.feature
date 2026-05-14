Feature: Unified Reasoning Parameter
  As a developer using LangWatch
  I want a single 'reasoning' field that maps to provider-specific parameters
  So that I don't need to manage three separate fields

  Background:
    Given the model registry contains reasoning configurations per model

  # Boundary Layer - Writing (mapReasoningToProvider)
  @unit
  Scenario: Maps reasoning to reasoning_effort for OpenAI models
    Given a prompt config with model "openai/gpt-5" and reasoning "high"
    When mapping reasoning to provider parameters
    Then the result should be { reasoning_effort: "high" }

  @unit
  Scenario: Maps reasoning to reasoning_effort for Gemini models
    Given a prompt config with model "gemini/gemini-3-flash" and reasoning "low"
    When mapping reasoning to provider parameters
    Then the result should be { reasoning_effort: "low" }
    # LiteLLM expects reasoning_effort and transforms internally

  @unit
  Scenario: Maps reasoning to reasoning_effort for Anthropic models
    Given a prompt config with model "anthropic/claude-opus-4" and reasoning "medium"
    When mapping reasoning to provider parameters
    Then the result should be { reasoning_effort: "medium" }
    # LiteLLM expects reasoning_effort and transforms internally

  @unit
  Scenario: Returns undefined when reasoning is empty string
    Given a prompt config with reasoning ""
    When mapping reasoning to provider parameters
    Then the result should be undefined

  # Boundary Layer - Reading (normalizeReasoningFromProviderFields)
  # These scenarios handle backward compatibility with existing data that used provider-specific fields
  @unit
  Scenario: Normalizes reasoning_effort to reasoning
    Given database config with reasoning_effort "high"
    When normalizing to unified format
    Then the result should have reasoning "high"

  @unit
  Scenario: Normalizes thinkingLevel to reasoning
    Given database config with thinkingLevel "low"
    When normalizing to unified format
    Then the result should have reasoning "low"

  @unit
  Scenario: Normalizes effort to reasoning
    Given database config with effort "medium"
    When normalizing to unified format
    Then the result should have reasoning "medium"
