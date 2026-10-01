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

  # Until a group is in the pending index it is found by reading the lifecycle
  # indexes in sequence, which is the read a moving group can slip through.
  # Adopting it on first sight bounds that exposure at "until first seen" rather
  # than "until the group drains", which matters through a rolling deploy where
  # pods on the previous release are still staging jobs.
  @integration
  Scenario: A group known only to the lifecycle indexes is adopted into the pending index
    Given a group holding jobs that the pending index does not list
    When the reconcile runs
    Then its jobs are counted
    And it is added to the pending index for later passes

  # Adoption only helps a group the pass actually saw, and the lifecycle indexes
  # are read one after another, so a group moving between them is seen by
  # neither. Reading the keyspace finds a group by the existence of its jobs,
  # which no movement between indexes changes — the one enumeration that cannot
  # miss one, kept for exactly the groups the index has not learned yet.
  @integration
  Scenario: A group no index lists is still counted and adopted
    Given a group holding jobs that no index lists
    When the reconcile runs
    Then its jobs are counted
    And it is added to the pending index for later passes

  # The keyspace walk is the only enumeration that cannot miss a group, so it is
  # kept as a backstop long after the index has caught up. A backstop that is
  # rescheduled by passes which never ran it is not a backstop: the deadline
  # outruns the clock and the walk never comes due again.
  @unit
  Scenario: Reconciles between sweeps do not postpone the scheduled sweep
    Given a sweep has run and found nothing to adopt
    When reconciles keep running before the next sweep is due
    Then the sweep still runs once its interval has elapsed

  @unit
  Scenario: A sweep that adopts keeps sweeping on the next pass
    Given a sweep finds a group holding jobs that the index does not list
    When the next reconcile runs
    Then it sweeps again without waiting for the interval

  # A group listed in a lifecycle index while holding no jobs is adopted, pruned
  # for being empty, and found again on the next pass. Treating that as progress
  # would answer "sweep again" forever over work that does not exist.
  @unit
  Scenario: A drained group listed in a lifecycle index does not pin the sweep
    Given a group listed in a lifecycle index whose jobs have all gone
    When reconciles keep running
    Then the sweep still backs off to its interval

  # The reconcile is single-flighted, so on any given cycle only one instance
  # measures a drift. An instance reporting the drift it computed itself
  # therefore reports zero for every queue it did not win, and no instance ever
  # reports the true total. The measurement is shared, so the signal has to be.
  @integration
  Scenario: An instance that measured nothing reports the drift another instance measured
    Given one instance has reconciled a queue and measured a drift
    When a second instance that won no marker reports its drift
    Then it reports the same drift as the instance that measured it

  @integration
  Scenario: Drift is summed across queues whichever instance measured each one
    Given two queues whose drifts were measured by different instances
    When either instance reports its drift
    Then it reports the total across both queues

  # A queue that has never reconciled has no figure to read. It cannot
  # contribute to the total, but it must not take the rest of the total with it
  # either: one silent queue would otherwise report the whole fleet as clean.
  @integration
  Scenario: A queue with no published drift does not suppress the queues that have one
    Given one queue with a published drift and another that has never reconciled
    When drift is reported
    Then the total is the drift of the queue that published one

  # A published drift describes the count that was published with it. Letting
  # the two land separately would allow a pass to write the counter, lose the
  # marker, and still announce a drift for a count it never landed.
  @unit
  Scenario: A pass that loses the marker publishes neither the count nor the drift
    Given a reconcile pass that is overtaken before its write
    When it goes to publish
    Then neither the counter nor the drift is written

