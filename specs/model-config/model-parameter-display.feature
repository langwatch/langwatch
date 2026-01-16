Feature: Model Parameter Display
  As a user configuring an LLM
  I want to see and configure only the parameters supported by my selected model
  So that I can properly tune the model behavior without seeing irrelevant options

  Background:
    Given I am on a page with the LLM Config popover
    And model providers are loaded for my project

  # Dynamic Parameter Display
  @integration
  Scenario: Shows temperature for traditional models
    Given the selected model "openai/gpt-4.1" supports parameters:
      | temperature       |
      | top_p             |
      | max_tokens        |
      | frequency_penalty |
      | presence_penalty  |
    When I open the LLM Config popover
    Then I should see the Temperature parameter as a slider
    And the slider should have min 0 and max 2

  @integration
  Scenario: Shows reasoning effort for reasoning models
    Given the selected model "openai/gpt-5" supports parameters:
      | reasoning_effort |
      | verbosity        |
      | max_tokens       |
    When I open the LLM Config popover
    Then I should see the Reasoning Effort parameter as a dropdown
    And the dropdown should have options:
      | minimal |
      | low     |
      | medium  |
      | high    |

  @integration
  Scenario: Shows verbosity for GPT-5 models
    Given the selected model "openai/gpt-5" supports parameters:
      | reasoning_effort |
      | verbosity        |
      | max_tokens       |
    When I open the LLM Config popover
    Then I should see the Verbosity parameter as a dropdown
    And the dropdown should have options:
      | low    |
      | medium |
      | high   |

  @integration
  Scenario: Does not show temperature for reasoning-only models
    Given the selected model "openai/gpt-5" supports parameters:
      | reasoning_effort |
      | verbosity        |
      | max_tokens       |
    When I open the LLM Config popover
    Then I should not see the Temperature parameter

  @integration
  Scenario: Shows top_p for models that support it
    Given the selected model "anthropic/claude-3.5-sonnet" supports parameters:
      | temperature |
      | top_p       |
      | max_tokens  |
    When I open the LLM Config popover
    Then I should see the Top P parameter as a slider
    And the slider should have min 0 and max 1

  @integration
  Scenario: Shows penalty parameters when supported
    Given the selected model "openai/gpt-4.1" supports parameters:
      | temperature       |
      | frequency_penalty |
      | presence_penalty  |
    When I open the LLM Config popover
    Then I should see the Frequency Penalty parameter
    And I should see the Presence Penalty parameter

  # Max Tokens Slider
  @integration
  Scenario: Max tokens slider respects model limits
    Given the selected model has maxCompletionTokens of 16384
    When I open the LLM Config popover
    Then the Max Tokens slider should have max value of 16384

  @integration
  Scenario: Max tokens slider shows sensible default
    Given the selected model has maxCompletionTokens of 128000
    And no max_tokens value is set in the config
    When I open the LLM Config popover
    Then the Max Tokens slider should show a sensible default value
    And the default should be approximately 25% of 128000

  @integration
  Scenario: Max tokens slider has minimum of 256
    When I open the LLM Config popover
    Then the Max Tokens slider should have min value of 256

  # Default Fallback
  @integration
  Scenario: Shows default parameters for unknown models
    Given the selected model has no supportedParameters specified
    When I open the LLM Config popover
    Then I should see the Temperature parameter
    And I should see the Max Tokens parameter
    And I should not see the Top P parameter
    And I should not see the Frequency Penalty parameter

  # Parameter Value Changes
  @integration
  Scenario: Changing temperature updates the config
    Given I have opened the LLM Config popover
    When I change the Temperature slider to 0.7
    Then the LLM config should have temperature 0.7

  @integration
  Scenario: Changing reasoning effort updates the config
    Given I have opened the LLM Config popover for a reasoning model
    When I select "high" for Reasoning Effort
    Then the LLM config should have reasoning_effort "high"

  @integration
  Scenario: Changing max tokens updates the config
    Given I have opened the LLM Config popover
    When I change the Max Tokens slider to 8192
    Then the LLM config should have max_tokens 8192

  # Model Switching
  @integration
  Scenario: Parameters update when switching models
    Given I have opened the LLM Config popover with model "openai/gpt-4.1"
    And I can see Temperature and Top P parameters
    When I switch to model "openai/gpt-5"
    Then I should see Reasoning Effort parameter
    And I should not see Temperature parameter

  @integration
  Scenario: No validation errors when switching to reasoning model
    Given I am on the prompts page
    And I have selected model "openai/gpt-4.1" with temperature 0.7
    When I switch to model "openai/gpt-5.2"
    Then I should not see any validation errors
    And temperature should not appear in the config popover

  @integration
  Scenario: Preserves compatible parameter values when switching models
    Given I have set max_tokens to 4096 on model "openai/gpt-4.1"
    When I switch to model "anthropic/claude-3.5-sonnet"
    Then max_tokens should still be 4096 if within new model's limits

  # UI Layout
  @visual
  Scenario: Parameters are displayed in a consistent order
    Given the selected model supports multiple parameters
    When I open the LLM Config popover
    Then parameters should be displayed in this order:
      | reasoning_effort  |
      | verbosity         |
      | temperature       |
      | max_tokens        |
      | top_p             |
      | frequency_penalty |
      | presence_penalty  |

  @visual
  Scenario: Each parameter shows a helpful label
    When I open the LLM Config popover
    Then each visible parameter should have a label
    And sliders should show their current value

  # Compact Design
  @visual
  Scenario: Popover has a compact design
    When I open the LLM Config popover
    Then the popover should have a reasonable width
    And parameters should be stacked vertically
    And there should be minimal padding between parameters
