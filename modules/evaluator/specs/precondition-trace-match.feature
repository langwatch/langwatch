@evaluator @preconditions
Feature: Which traces a check would run on
  As someone trying out a check before saving it
  I want the sample to tell me which traces the check would actually run on
  So that I can see my preconditions and the evaluator's required fields at work

  @unit
  Scenario: Only traces passing every precondition match
    Given two traces, one whose input contains "refund" and one whose does not
    When the traces are matched against the precondition input contains "refund"
    Then only the trace whose input contains "refund" is returned

  @unit
  Scenario: A trace missing the evaluator's required field fails the match
    Given a check whose evaluator requires an expected output
    And a trace without an expected output
    When the trace is matched against the check's preconditions
    Then the trace does not match

  @unit
  Scenario: An unknown evaluator type is refused as invalid input
    Given an evaluator type that is neither in the catalogue nor custom
    When traces are matched for it
    Then the call is refused with validation_error

  @unit
  Scenario: A malformed precondition is refused as invalid input
    Given a precondition with a rule the checks do not know
    When traces are matched against it
    Then the call is refused with validation_error
