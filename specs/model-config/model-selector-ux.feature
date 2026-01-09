@integration
Feature: Model Selector UX Improvements
  As a user selecting an LLM model
  I want a compact and intuitive model selector
  So that I can quickly choose and configure the right model for my task

  Background:
    Given I am on a page with the model selector
    And model providers are loaded for my project

  # Compact Trigger Display
  Scenario: Shows model name with provider icon in trigger
    Given the selected model is "openai/gpt-5"
    Then the trigger should display the OpenAI icon
    And the trigger should display "gpt-5" as the model name

  Scenario: Shows key parameter value in trigger subtitle
    Given the selected model is "openai/gpt-5" with reasoning_effort "minimal"
    Then the trigger should display "Minimal effort" as subtitle

  Scenario: Shows temperature in trigger for traditional models
    Given the selected model is "openai/gpt-4.1" with temperature 0.7
    Then the trigger should display "Temp 0.7" as subtitle

  # Model Selection Dropdown
  Scenario: Groups models by provider
    When I open the model selector dropdown
    Then models should be grouped by provider
    And each group should have a provider icon and name

  Scenario: Shows provider icon next to each model
    When I open the model selector dropdown
    Then each model option should have its provider icon

  Scenario: Supports search/filter functionality
    When I open the model selector dropdown
    And I type "claude" in the search box
    Then only models containing "claude" should be visible

  Scenario: Search is case-insensitive
    When I open the model selector dropdown
    And I type "GPT" in the search box
    Then models containing "gpt" should be visible

  # Model Selection
  Scenario: Selecting a model updates the config
    Given I have opened the model selector dropdown
    When I select "anthropic/claude-3.5-sonnet"
    Then the model config should have model "anthropic/claude-3.5-sonnet"
    And the dropdown should close

  Scenario: Shows only enabled providers
    Given provider "anthropic" is disabled for my project
    When I open the model selector dropdown
    Then I should not see any Anthropic models

  Scenario: Shows custom models added by user
    Given I have added custom model "custom/my-fine-tuned-model" to provider "custom"
    When I open the model selector dropdown
    Then I should see "my-fine-tuned-model" in the Custom provider group

  # Settings Access
  Scenario: Quick access to model provider settings
    When I open the LLM Config popover
    Then I should see a settings icon/button
    When I click the settings button
    Then it should open model provider settings in a new tab

  # Keyboard Navigation
  # no test - handled by Chakra UI Select component
  @visual
  Scenario: Supports keyboard navigation in dropdown
    When I open the model selector dropdown
    And I press the down arrow key
    Then the next model option should be highlighted
    When I press Enter
    Then that model should be selected

  # no test - handled by Chakra UI Select component
  @visual
  Scenario: Escape closes the dropdown
    When I open the model selector dropdown
    And I press Escape
    Then the dropdown should close
    And no model change should occur

  # Loading States
  Scenario: Shows loading state while fetching models
    Given model providers are being fetched
    When I view the model selector
    Then it should show a loading indicator or skeleton

  # Unknown Models
  Scenario: Handles unknown model in config gracefully
    Given my config has model "openai/nonexistent-model" that is not in the model list
    When I view the model selector
    Then it should display "nonexistent-model" as the current selection
    And I should still be able to select a different model
    # Unknown models can occur with custom providers or recently added models
