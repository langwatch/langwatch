Feature: Evaluation counts online evaluator outcomes for a staff investigation
  A staff ops function asks evaluation how a set of projects' online evaluators ran over a time
  range: runs, errors, skipped runs and errors by code, per evaluator. The answer carries ids,
  counts, codes and times only. A stored error is free text that may hold trace text or a
  provider echo, so evaluation reduces it to a code from a closed set inside the store and the
  message never leaves it (ADR-202, amendment 2026-11-25).

  @integration
  Scenario: Runs of each evaluator are counted with their errors by code
    Given a project whose evaluator ran three times in the range
    And one run settled as a timeout error and one was skipped
    When evaluation counts the project's evaluator outcomes over the range
    Then the evaluator shows 3 runs, 1 error, 1 skipped and 1 "timeout" error
    And the time of the last error

  @integration
  Scenario: Only the latest revision of a run is counted
    Given a run that first errored and was then processed on a retry
    When evaluation counts the project's evaluator outcomes
    Then the run counts once and not as an error

  @integration
  Scenario: Another project's runs are never counted
    Given two projects with evaluator runs in the range
    When evaluation counts outcomes for one of them
    Then only that project's evaluators appear

  @integration
  Scenario: Runs outside the range are not counted
    Given a run scheduled before the range starts
    When evaluation counts the project's evaluator outcomes over the range
    Then the run is not counted

  @unit
  Scenario: An error message never reaches the answer
    Given stored error messages with prompt text, a provider echo and an API key
    When each message is reduced to its code
    Then each reads as a code from the closed set or "other", never as its text

  @unit
  Scenario: A message that is already a plain code keeps it
    Given a stored error message "missing_model_provider"
    When the message is reduced to its code
    Then the code is "missing_model_provider"
