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

  # The reconcile has to decide which groups to count. Asking the lifecycle
  # indexes cannot answer that safely: they are read one after another, and a
  # group moving between them mid-read is in none of the reads even though it
  # never stopped holding jobs. The pending index is keyed on holding jobs
  # instead, which no lifecycle transition changes.
  @integration
  Scenario: A group counted from the pending index needs no lifecycle membership
    Given a group holding jobs while it moves between lifecycle states
    When the reconcile runs
    Then its jobs are still counted

  @integration
  Scenario: A drained group is dropped from the pending index
    Given a group listed as pending whose jobs have all gone
    And another listed group that still holds jobs
    When the reconcile runs
    Then the drained group is dropped from the index
    And the group that still holds jobs is kept

  # Two passes must never both publish. A pass that lost the marker cannot know
  # whether a newer one has already written, so its count is only safe to
  # discard — publishing it would put a stale number back over a fresh one.
  @unit
  Scenario: A pass that loses the marker mid-run publishes nothing
    Given a reconcile pass that is overtaken by another instance
    When it finishes computing its count
    Then it discards the pass
    And the counter is left for the instance that now holds the marker

  @unit
  Scenario: A pass whose marker lapses unclaimed publishes nothing
    Given a reconcile pass whose marker expires with nobody taking it
    When it finishes computing its count
    Then it declines to write

  @unit
  Scenario: The counter write itself refuses to run without the marker
    Given a reconcile pass that keeps the marker until its final check
    And the marker changes hands before the write lands
    When the pass goes to write its result
    Then nothing is published
