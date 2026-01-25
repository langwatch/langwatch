Feature: Model Parameter Constraints
  As a user configuring an LLM
  I want parameter inputs to respect provider-specific limits
  So that I don't send invalid values to the API

  Background:
    Given llmModels.json is immutable and cannot be modified
    And parameter constraints are defined per provider in registry.ts

  # Unit Tests: Constraint Resolution

  @unit
  Scenario: Anthropic provider has temperature max 1.0
    Given the provider "anthropic" has parameterConstraints:
      | parameter   | min | max |
      | temperature | 0   | 1   |
    When resolving constraints for model "anthropic/claude-sonnet-4"
    Then temperature constraint should have max 1.0
    And temperature constraint should have min 0

  @unit
  Scenario: OpenAI provider uses global defaults
    Given the provider "openai" has no parameterConstraints for temperature
    When resolving constraints for model "openai/gpt-4.1"
    Then temperature constraint should be undefined
    # UI falls back to global default max 2.0 from parameterRegistry

  @unit
  Scenario: Unknown provider returns undefined constraints
    Given a model ID "unknown-provider/some-model"
    When resolving constraints for that model
    Then the result should be undefined

  @unit
  Scenario: Model ID without provider prefix returns undefined
    Given a model ID "standalone-model"
    When resolving constraints for that model
    Then the result should be undefined

  # Unit Tests: Value Clamping (Python Backend)

  @unit
  Scenario: Clamping temperature above provider max
    Given a temperature value of 1.5
    And provider "anthropic" has temperature max 1.0
    When clamping the value to provider constraints
    Then the result should be 1.0

  @unit
  Scenario: Clamping temperature below provider min
    Given a temperature value of -0.5
    And provider "anthropic" has temperature min 0
    When clamping the value to provider constraints
    Then the result should be 0

  @unit
  Scenario: Value within constraints unchanged
    Given a temperature value of 0.7
    And provider "anthropic" has temperature min 0 and max 1.0
    When clamping the value to provider constraints
    Then the result should be 0.7

  @unit
  Scenario: Provider without constraints returns original value
    Given a temperature value of 1.8
    And provider "openai" has no temperature constraints
    When clamping the value to provider constraints
    Then the result should be 1.8

  # Integration Tests: UI Slider Behavior

  @integration
  Scenario: Temperature slider respects Anthropic constraints
    Given I am on a page with the LLM Config popover
    And model providers are loaded for my project
    And the selected model is "anthropic/claude-sonnet-4"
    When I open the LLM Config popover
    Then the Temperature slider max should be 1.0
    And the Temperature slider min should be 0

  @integration
  Scenario: Temperature slider uses global defaults for OpenAI
    Given I am on a page with the LLM Config popover
    And model providers are loaded for my project
    And the selected model is "openai/gpt-4.1"
    When I open the LLM Config popover
    Then the Temperature slider max should be 2.0
    And the Temperature slider min should be 0

  @integration
  Scenario: Switching from OpenAI to Anthropic updates slider constraints
    Given I am on a page with the LLM Config popover
    And the selected model is "openai/gpt-4.1"
    And I have set temperature to 1.5
    When I switch to model "anthropic/claude-sonnet-4"
    Then the Temperature slider max should be 1.0
    And the temperature value should be clamped to 1.0

  @integration
  Scenario: Input field respects provider constraints
    Given I am on a page with the LLM Config popover
    And the selected model is "anthropic/claude-sonnet-4"
    When I type "1.5" in the Temperature input field
    And I blur the input field
    Then the temperature value should be clamped to 1.0

  # Defense in Depth: API Validation

  @integration
  Scenario: Backend clamps out-of-range temperature for Anthropic
    Given a prompt execution request with:
      | model                      | anthropic/claude-sonnet-4 |
      | temperature                | 1.5                       |
    When the request is processed by the NLP service
    Then the effective temperature sent to LiteLLM should be 1.0
