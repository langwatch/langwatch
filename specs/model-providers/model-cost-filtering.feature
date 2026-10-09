Feature: Filtering the model costs table
  As someone reading Settings > Model Costs
  I want to narrow the long table of model prices
  So that I can find one model without scrolling the whole catalogue

  Background:
    Given the model costs table lists catalogue rates and project cost rules

  @integration
  Scenario: Searching narrows the table by model name or regex rule
    When I search for "CLAUDE"
    Then only models whose name or regex rule contains "claude" are listed
    And the count line reads "Showing 1 of 3 models."

  @integration
  Scenario: The provider filter narrows the table to one provider
    When I pick the "openai" provider
    Then only models named "openai/..." are listed

  @integration
  Scenario: Custom only shows just the project's own cost rules
    When I turn on "Custom only"
    Then only stored cost rules are listed, not catalogue rates

  @integration
  Scenario: A filter that matches nothing shows an empty state
    When I search for a model that does not exist
    Then I see "No models match" with a "Clear filters" action

  @integration
  Scenario: Clearing the filters restores every model
    Given I have searched and picked a provider
    When I clear the filters
    Then every model is listed again
    And the count line reads "What each of the 3 models costs per token."
