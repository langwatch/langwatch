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
