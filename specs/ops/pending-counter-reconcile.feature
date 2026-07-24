Feature: GroupQueue pending counter ground-truth reconcile
  As an operator monitoring the GroupQueue dashboard
  I want the pending counter to self-heal to the live ground truth
  So that the "pending jobs" tile reflects reality even after worker deaths,
  TTL reaps, or DLQ moves that cannot decrement the counter atomically

  Background:
    Given a GroupQueue whose pending counter is tracked separately from the jobs

  @integration @regression
  Scenario: Reconcile heals an over-counted pending counter to the live ground truth
    Given the pending counter reports 100
    And the actual job zsets sum to 5 jobs
    When the reconcile runs
    Then the pending counter is corrected to 5
    And the reconcile result reports a drift of 95

  @integration
  Scenario: Reconcile returns zero drift when the counter is already accurate
    Given the pending counter matches the number of jobs in the queue
    When the reconcile runs
    Then the pending counter is unchanged
    And the reconcile result reports a drift of 0

  @integration
  Scenario: Reconcile corrects an under-counted pending counter upward to ground truth
    Given the pending counter reports 3
    And the actual job zsets sum to 7 jobs
    When the reconcile runs
    Then the pending counter is corrected to 7
    And the reconcile result reports a drift of -4

  @integration
  Scenario: Reconcile sets the counter to zero when no jobs remain
    Given the pending counter reports 50
    And no jobs remain in the queue
    When the reconcile runs
    Then the pending counter is corrected to 0
    And the reconcile result reports a drift of 50

  @integration
  Scenario: Single-flight gate prevents a redundant reconcile within the same window
    Given the reconcile ran once and healed the counter
    When the reconcile is triggered again immediately within the same window
    Then the second call is skipped
    And the counter remains as healed by the first call
