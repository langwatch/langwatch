Feature: A completed run's summary carries its evaluator verdicts
  As a developer gating CI on an experiment run
  I want the polled summary to count how many evaluations passed and failed
  So that the SDKs and the CLI can fail the job when quality drops, if I opt in

  # The summary schema declared evaluators, totalPassed, totalFailed and
  # passRate, but the progress fold filled only cell counts. Every client fell
  # back to failedCells, so a run whose evaluators all failed still exited 0.
  # Released SDKs exit 1 on `totalFailed ?? failedCells`, so the run-wide totals
  # stay unset: only the per-evaluator tallies are added, and new clients gate on
  # them behind an opt-in flag.

  @unit
  Scenario: A completed run tallies each evaluator's verdicts
    Given a run whose evaluator "exact_match" passed on 2 cells and failed on 1
    When the run completes
    Then the summary lists "exact_match" with 2 passed, 1 failed and a pass rate of 66.7

  @unit
  Scenario: Run-wide totals stay unset so released SDKs keep their exit codes
    Given a run whose evaluator "exact_match" failed on 1 cell
    When the run completes
    Then the summary lists "exact_match" with 1 failed
    And the summary carries no totalPassed, totalFailed or passRate

  @unit
  Scenario: A score without a verdict counts towards the average only
    Given a run whose evaluator "faithfulness" returned scores 0.4 and 0.8 with no pass or fail
    When the run completes
    Then the summary lists "faithfulness" with 0 passed, 0 failed and an average score of 0.6

  @unit
  Scenario: A comparison evaluator keeps no verdicts and is left out
    Given a run with one comparison evaluator and one scoring evaluator
    When the run completes
    Then the summary lists only the scoring evaluator

  @unit
  Scenario: A run with no evaluators adds no verdict fields
    Given a run with targets and no evaluators
    When the run completes
    Then the summary carries cell counts only
