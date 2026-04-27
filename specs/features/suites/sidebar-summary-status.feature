Feature: Sidebar summary shows latest batch status correctly

  The sidebar must display pass rate and counts from only the latest batch
  for each scenario set. Stalled and cancelled runs are not "completed" but
  still count toward the total. When no runs have an actual verdict
  (SUCCESS/FAILED/ERROR), the sidebar shows a gray dash instead of "0%".

  # Pass rate = passed / total (all runs count in denominator)

  Scenario: Sidebar shows stats from the latest batch only
    Given an external set "my-set" with two batches
    And the latest batch has 2 passed and 1 failed
    And the older batch has 5 passed
    Then the sidebar shows "67%" and "2 passed"

  Scenario: All runs in latest batch are stalled
    Given an external set where the latest batch has 1 stalled run
    Then the sidebar shows "-" with a gray circle and "0 passed"
    And the tooltip shows "Completed 0/1 (1 stalled)"

  Scenario: Latest batch has mix of passed and stalled
    Given a batch with 2 passed and 1 stalled
    Then pass rate is 67% (2/3 total)
    And tooltip shows "Completed 2/3 (1 stalled)"

  Scenario: All runs cancelled
    Given a batch where all 3 runs are cancelled
    Then the sidebar shows "-" with a gray circle and "0 passed"
    And tooltip shows "Completed 0/3 (3 cancelled)"

  Scenario: All runs failed
    Given a batch where all 2 runs failed
    Then the sidebar shows "0%" with a red circle and "0 passed"
    And tooltip shows "Completed 2/2 (2 failed)"

  Scenario: Mix of passed, failed, stalled, cancelled
    Given a batch with 3 passed, 1 failed, 1 stalled, 1 cancelled
    Then pass rate is 50% (3/6 total)
    And tooltip shows "Completed 4/6 (1 failed, 1 stalled, 1 cancelled)"
