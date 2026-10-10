Feature: Empty option lists
  Scenario: An empty picker explains how to create its options inline
    Given a picker has finished loading with no options
    Then its trigger is disabled and describes the inline hint
    And the hint offers a link to create the missing option

  Scenario: Option items retain native button behavior
    When a selectable option is activated
    Then its action runs without submitting the enclosing form
