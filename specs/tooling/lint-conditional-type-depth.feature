Feature: The conditional-type-depth lint rule
  A conditional type nested past a few levels is a computation nobody can evaluate
  by eye, deriving what a plain interface or a discriminated union could have stated.
  The rule reports the type's name and the depth it measured next to the fix.

  Background:
    Given a workspace whose project feature is at strict layout version 0

  @unit
  Scenario: A conditional type nested past the maximum is reported with its depth
    Given a contract module whose type alias nests four conditional types
    When the conditional-type-depth rule runs over it
    Then it reports stateTheShape
    And the message names the type, the depth it measured and the maximum
    And the message tells the reader to state the shape rather than derive it

  @unit
  Scenario: A conditional type inside the maximum is left alone
    Given a contract module whose type alias nests three conditional types
    When the conditional-type-depth rule runs over it
    Then it reports nothing
