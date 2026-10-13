Feature: An aggregate rule has one of three shapes
  The rule an aggregate project stores (ADR-177 block D) is one of three kinds.
  The new-project flow refuses any other shape, and the reconciler reads a
  stored column that does not parse as no rule rather than trusting a cast.

  @unit
  Scenario: The rule names exactly three kinds and defaults to all personal projects
    Given the aggregate rule shapes
    Then the kinds are all personal, personal by department and explicit
    And the default rule is all personal projects

  @unit
  Scenario: An explicit rule with no projects or a rule with stray fields is refused
    When a rule names the explicit kind with no projects, or carries a field its kind does not
    Then the rule is refused

  @unit
  Scenario: A stored rule that does not parse reads as no rule
    Given an aggregate whose stored rule column is malformed or empty
    When the reconciler reads the aggregate
    Then the aggregate reads as having no rule
    And each well-formed kind reads back as stored
