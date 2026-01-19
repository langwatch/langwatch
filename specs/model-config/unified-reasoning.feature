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
  Scenario: Maps reasoning to thinkingLevel for Gemini models
    Given a prompt config with model "gemini/gemini-3-flash" and reasoning "low"
    When mapping reasoning to provider parameters
    Then the result should be { thinkingLevel: "low" }

  @unit
  Scenario: Maps reasoning to effort for Anthropic models
    Given a prompt config with model "anthropic/claude-opus-4" and reasoning "medium"
    When mapping reasoning to provider parameters
    Then the result should be { effort: "medium" }

  @unit
  Scenario: Uses model reasoningConfig.parameterName when available
    Given a model with reasoningConfig.parameterName "custom_reasoning"
    And a prompt config with reasoning "high"
    When mapping reasoning to provider parameters
    Then the result should be { custom_reasoning: "high" }

  @unit
  Scenario: Returns undefined when reasoning is not set
    Given a prompt config with no reasoning value
    When mapping reasoning to provider parameters
    Then the result should be undefined

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

  @unit
  Scenario: reasoning takes precedence over provider-specific fields
    Given database config with reasoning "high" and reasoning_effort "low"
    When normalizing to unified format
    Then the result should have reasoning "high"

  @unit
  Scenario: Falls back through provider-specific fields if reasoning not set
    Given database config with no reasoning but effort "medium"
    When normalizing to unified format
    Then the result should have reasoning "medium"

  @unit
  Scenario: Falls back in priority order reasoning > reasoning_effort > thinkingLevel > effort
    Given database config with thinkingLevel "low" and effort "high"
    When normalizing to unified format
    Then the result should have reasoning "low"

  @unit
  Scenario: Returns undefined when no reasoning fields are set
    Given database config with no reasoning fields
    When normalizing to unified format
    Then the result should be undefined
