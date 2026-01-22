Feature: Unified Reasoning UI Component
  As a user configuring an LLM
  I want to see a single "Reasoning" dropdown for all providers
  So that I don't need to know provider-specific parameter names

  Background:
    Given I am on a page with the LLM Config popover

  # Single Reasoning Dropdown Display
  @integration
  Scenario: Shows single Reasoning dropdown for OpenAI reasoning model
    Given the selected model "openai/gpt-5" has reasoningConfig with allowedValues ["low", "medium", "high"]
    When I open the LLM Config popover
    Then I should see a "Reasoning" dropdown
    And the dropdown should have options ["low", "medium", "high"]
    And I should NOT see "Reasoning Effort" dropdown
    And I should NOT see "Thinking Level" dropdown
    And I should NOT see "Effort" dropdown

  @integration
  Scenario: Shows single Reasoning dropdown for Gemini reasoning model
    Given the selected model "gemini/gemini-3-flash" has reasoningConfig with allowedValues ["low", "high"]
    When I open the LLM Config popover
    Then I should see a "Reasoning" dropdown
    And the dropdown should have options ["low", "high"]

  @integration
  Scenario: Shows single Reasoning dropdown for Anthropic reasoning model
    Given the selected model "anthropic/claude-opus-4" has reasoningConfig with allowedValues ["low", "medium", "high"]
    When I open the LLM Config popover
    Then I should see a "Reasoning" dropdown
    And the dropdown should have options ["low", "medium", "high"]

  @integration
  Scenario: Shows extended options for models with more reasoning levels
    Given the selected model "openai/gpt-5.2-codex" has reasoningConfig with allowedValues ["none", "low", "medium", "high", "xhigh"]
    When I open the LLM Config popover
    Then I should see a "Reasoning" dropdown
    And the dropdown should have options ["none", "low", "medium", "high", "xhigh"]

  # No Reasoning Dropdown for Non-Reasoning Models
  @integration
  Scenario: Does not show Reasoning dropdown for non-reasoning models
    Given the selected model "openai/gpt-4.1" has no reasoningConfig
    When I open the LLM Config popover
    Then I should NOT see a "Reasoning" dropdown
    And I should see "Temperature" parameter

  # Value Selection
  @integration
  Scenario: Selecting reasoning value updates form with unified field
    Given I have opened the LLM Config popover for model "openai/gpt-5"
    When I select "high" from the Reasoning dropdown
    Then the form should have llm.reasoning = "high"
    And the form should NOT have llm.reasoningEffort

  @integration
  Scenario: Changing reasoning value triggers onChange callback
    Given I have opened the LLM Config popover for a reasoning model
    And the current reasoning value is "low"
    When I select "high" from the Reasoning dropdown
    Then the onChange callback should be called with reasoning "high"

  # Dynamic Options from Model Configuration
  @integration
  Scenario: Reasoning options come from model's reasoningConfig.allowedValues
    Given the selected model has reasoningConfig with allowedValues ["low", "high"]
    When I open the LLM Config popover
    Then the Reasoning dropdown should have exactly 2 options
    And the options should be ["low", "high"]

  @integration
  Scenario: Reasoning default comes from model's reasoningConfig.defaultValue
    Given the selected model has reasoningConfig with defaultValue "medium"
    And no reasoning value is currently set
    When I open the LLM Config popover
    Then the Reasoning dropdown should show "medium" as default

  # Model Switching
  @integration
  Scenario: Reasoning dropdown updates when switching between reasoning models
    Given I have selected model "openai/gpt-5" with reasoningConfig ["low", "medium", "high"]
    When I switch to model "gemini/gemini-3-flash" with reasoningConfig ["low", "high"]
    Then the Reasoning dropdown should have options ["low", "high"]

  @integration
  Scenario: Reasoning dropdown disappears when switching to non-reasoning model
    Given I have selected model "openai/gpt-5" with reasoningConfig
    And I can see the Reasoning dropdown
    When I switch to model "openai/gpt-4.1" without reasoningConfig
    Then I should NOT see the Reasoning dropdown

  # Parameter Display Order
  @visual
  Scenario: Reasoning appears at the top of reasoning parameters
    Given the selected model supports reasoning
    When I open the LLM Config popover
    Then the Reasoning parameter should appear before Verbosity
    And the Reasoning parameter should appear before Temperature

  # Accessibility
  @integration
  Scenario: Reasoning dropdown is keyboard accessible
    Given I have opened the LLM Config popover for a reasoning model
    When I focus on the Reasoning dropdown
    Then I should be able to navigate options with keyboard
    And I should be able to select an option with Enter key
