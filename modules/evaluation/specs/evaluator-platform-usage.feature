Feature: Evaluation counts evaluator usage across the platform for a staff investigation
  A staff ops function asks evaluation which evaluator types run across every tenant over a time
  range: distinct projects, runs, errors by code and skipped runs per type. The answer carries
  counts and codes only; a stored error message is reduced to its code inside the store and the
  text never leaves it (ADR-202, amendment 2026-11-25).

  @integration
  Scenario: Each evaluator type is counted across every project
    Given evaluation runs of one evaluator type in two projects within the range
    When evaluation counts usage by evaluator type over the range
    Then the type carries 2 projects, its runs, its errors by code and its skipped count
    And no error message

  @integration
  Scenario: A revised run counts once by its latest revision
    Given a run that first errored and was then processed on a retry
    When evaluation counts usage by evaluator type
    Then the run counts once and not as an error

  @integration
  Scenario: Runs outside the range are not counted in the platform usage
    Given a run scheduled before the range starts
    When evaluation counts usage by evaluator type over the range
    Then the run is not counted
