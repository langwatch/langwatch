Feature: Evaluation tells when a monitor's runs are mostly errors
  Evaluation owns every run's outcome. For each on-message monitor it counts the runs that
  settled in the last hour, and how many of them settled as an error, per revision of the
  monitor (a change to the monitor starts the count again). When at least 50 runs settled and
  at least 90% of them are errors, evaluation records one fact on its evaluation_lifecycle
  pipeline. Monitor reacts from its own side (modules/monitor/specs/monitor-auto-pause.feature).
  A failed verdict (passed = false) is a working evaluator and never counts as an error;
  a skipped run counts as neither.

  @unit
  Scenario: A monitor whose runs are mostly errors is reported once it reaches the threshold
    Given an on-message monitor with 50 settled runs in the last hour
    And 45 of them settled as an error
    When the 45th error is recorded
    Then evaluation records that the monitor's error rate was exceeded
    And the fact carries the run count, the error count and the most common error message

  @unit
  Scenario: A monitor below the minimum volume is not reported
    Given an on-message monitor with 49 settled runs in the last hour, all of them errors
    When another error would be needed to reach 50 runs
    Then evaluation records nothing

  @unit
  Scenario: Failed verdicts and skipped runs are not errors
    Given an on-message monitor whose 100 runs in the last hour all returned passed = false
    And 100 more of its runs were skipped
    When the runs are recorded
    Then evaluation records nothing

  @unit
  Scenario: A monitor under the error ratio is not reported
    Given an on-message monitor with 100 settled runs in the last hour
    And 89 of them settled as an error
    When the runs are recorded
    Then evaluation records nothing

  @unit
  Scenario: The fact is recorded once per monitor revision, not per evaluation
    Given an on-message monitor that has already been reported for its current revision
    When 100 more errors are recorded for the same revision
    Then evaluation records no further fact

  @unit
  Scenario: Guardrails and manual monitors are never counted
    Given a guardrail run and a manual monitor's run, each settled as an error 100 times
    When the runs are recorded
    Then evaluation records nothing

  @unit
  Scenario: Counting never fails the evaluation
    Given the counter store refuses every write
    When an evaluation settles as an error
    Then the evaluation's reported event is still emitted

  @unit
  Scenario: The reported error message carries no secret
    Given an error message holding an API key, a bearer token and a URL with a password
    When it is shortened for the fact
    Then the key, the token and the password are replaced with "[redacted]"
    And the message is at most 200 characters long

  @integration
  Scenario: The window counts are shared through Redis
    Given two workers recording runs for the same monitor revision against the same Redis
    When each records half of the runs
    Then both read the same run and error counts
    And only one of them claims the report for the revision
