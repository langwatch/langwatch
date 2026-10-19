Feature: Shared destructive confirmation
  @integration
  Scenario: Destructive confirmation gates clicks and Enter with the same phrase
    Given a destructive dialog with a labelled confirmation input
    Then clicks and Enter require the confirmation phrase
    And reopening clears the phrase

  @integration
  Scenario: Loading prevents destructive confirmation
    Given an action or its related items are loading
    Then confirmation remains unavailable by click and Enter

  @integration
  Scenario: Consequences name affected items without a warning callout
    Given affected items grouped by kind
    Then plain rows show counts and archived or deleted outcomes
    And each group shows at most five names and the remaining count

  @integration
  Scenario: Exact operator phrases preserve case and whitespace rules
    Given an operator action requiring an exact phrase
    Then the dialog preserves case sensitivity and the caller's whitespace policy

  @integration
  Scenario: The confirmation is an alert dialog that does not click through
    Given a destructive dialog opened from a clickable row
    Then it is an alert dialog named by its title
    And clicking inside it does not reach the row
    And Escape asks the caller to close it

  @integration
  Scenario: Closing a confirmation hands focus to the element the caller names
    Given a confirmation that was given a live focus target and an exit callback
    When the reader cancels, or confirms and the caller closes it
    Then focus lands on the element the target resolves to at that moment
    And the exit callback runs once, after the dialog has left, never on the confirm click

  @integration
  Scenario: A confirmation that is not given a focus target or exit callback behaves as before
    Given a confirmation without either
    When the reader cancels
    Then it closes and asks the caller to close it, with nothing else run

  @integration
  Scenario: A busy confirmation neither closes nor confirms again
    Given a confirmation whose action is loading
    When the reader presses Escape or the confirm button
    Then the caller is not asked to close it and the action does not run again
