Feature: The overload-by-literal lint rule
  Two overloads that differ only by a boolean literal property are one function the
  caller has to diff two signatures to understand. The rule names the function and
  the property that flips, so the reader knows which flag is doing the work.

  Background:
    Given a workspace whose project feature is at strict layout version 0

  @unit
  Scenario: Overloads that differ only by a boolean literal are reported with the property
    Given a contract module whose function overloads flip one property between true and false
    When the overload-by-literal rule runs over it
    Then it reports splitTheOverloads
    And the message names the function and the property that flips
    And the message tells the reader to give the two behaviours two names

  @unit
  Scenario: Overloads that differ by an actual type are left alone
    Given a contract module whose function overloads take two different option types
    When the overload-by-literal rule runs over it
    Then it reports nothing
