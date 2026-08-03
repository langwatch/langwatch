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

  @integration
  Scenario: Reconcile counts blocked and parked groups alongside ready ones
    Given jobs are spread across ready, blocked, and parked groups
    When the reconcile runs
    Then the pending counter equals the sum of jobs across all three group indexes

  @integration
  Scenario: Reconcile counts a group listed in two indexes only once
    Given a group appears in more than one group index at the same time
    When the reconcile runs
    Then that group's jobs are counted exactly once

  @integration
  Scenario: An overrunning reconcile releases the marker instead of holding it past the window
    Given a reconcile pass that takes longer than the single-flight window
    When the pass completes
    Then the single-flight marker is released
    And the next trigger may start a fresh reconcile immediately

  @integration
  Scenario: A declined reconcile leaves the holder's marker untouched
    Given another instance currently holds the single-flight marker
    When a reconcile is triggered
    Then the trigger declines without running
    And the holder's marker and its expiry are left untouched
