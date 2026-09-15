Feature: The empty-catch lint rule
  Swallowing a failure is a decision, and a decision that is not written down
  cannot be reviewed. An empty catch reads the same whether the author knew
  the call was best-effort or never thought about it, and the difference is
  the whole of the incident.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: An empty catch swallows the failure
    Given a try statement whose catch block is empty and takes no binding
    When the empty-catch rule runs over it
    Then it reports emptyCatch
    And the message names the form the catch was written in

  @unit
  Scenario: An empty catch that binds the error still swallows it
    Given a try statement whose catch block is empty and binds the error
    When the empty-catch rule runs over it
    Then it reports emptyCatch

  @unit
  Scenario: A catch holding only a comment is still empty
    Given a try statement whose catch block holds only a comment
    When the empty-catch rule runs over it
    Then it reports emptyCatch

  @unit
  Scenario: A catch that rethrows is allowed
    Given a try statement whose catch block rethrows
    When the empty-catch rule runs over it
    Then it reports nothing

  @unit
  Scenario: A catch that returns a fallback is allowed
    Given a try statement whose catch block returns a fallback
    When the empty-catch rule runs over it
    Then it reports nothing
