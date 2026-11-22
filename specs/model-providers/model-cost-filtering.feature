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
  Scenario: Asking which rule matches a model string narrows the table to those rules
    When I type "anthropic/claude-haiku-4-5-20260101" into "Which rule matches this model?"
    Then only models whose regex rule matches that string are listed

  @integration
  Scenario: The cost drawer tests a regex against a sample model string as you type
    Given the cost drawer is open with a regex
    When I type a sample model string
    Then it says "Match" or "No match", and an invalid regex shows an inline error

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

  @integration
  Scenario: The wide table scrolls inside its card instead of the page
    Given the table is wider than the page column
    Then the card scrolls horizontally
    And the page itself does not scroll sideways

  @integration
  Scenario: Clicking a stored cost rule opens it in the editor
    When I click the row of a cost rule the project stored
    Then the cost editor opens on that rule

  @integration
  Scenario: Clicking a catalogue rate opens an override for it
    When I click the row of a catalogue rate
    Then the cost editor opens pre-filled from that rate, saving a new rule
    And the row's actions menu names this "Override cost"

  @integration
  Scenario: Rates read as dollars per million tokens
    Given a model whose input costs 0.00001 per token
    Then its input cell reads "$10.00 / 1M"
    And hovering it shows the exact "$0.00001 per token"
