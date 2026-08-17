# Companion to process-manager-visibility.feature (which put dead letters on a
# page) — this spec is what an operator can DO about them, on both dead-letter
# substrates: the process-manager outbox (Postgres) and the GroupQueue DLQ
# (Redis). Controls follow best_practices/ops-dashboard.md: explicit,
# manage-gated, audited, blast radius named.

Feature: Dead-letter recovery
  As an operator triaging dead letters
  I want to redrive what should run again and discard what never should
  So that the dead-letter count returns to zero without clicking one row at a time

  Context: dead letters could only be redriven, one at a time, and nothing
  could ever be discarded — a permanently poisoned message sat in the count
  forever, indistinguishable from work still worth redriving. Discard is a
  mark, not a delete: the outbox row is retained as its own audit trail, and
  the substrate never sends the message again.

  # ── Discard: the outbox ───────────────────────────────────────────────

  @integration
  Scenario: Discarding a dead message marks it and keeps it
    Given a dead outbox message
    When the operator discards it
    Then the message is marked discarded, not deleted
    And the dispatcher never leases it again
    And the discard lands in the audit trail

  @integration
  Scenario: Only a dead message can be discarded
    Given a pending outbox message
    When an operator attempts to discard it
    Then the message is unchanged
    And the act reports that it did not apply

  @integration
  Scenario: Discarded messages leave the dead-letter count
    Given dead messages on one process
    When the operator discards one of them
    Then the dead-letter listing and its counts no longer include it

  # ── Bulk recovery, scoped to what is shown ────────────────────────────

  @integration
  Scenario: Every dead letter shown can be redriven in one act
    Given dead messages belonging to several process names
    When the operator redrives all dead letters for one process name
    Then that process name's dead messages return to pending with a fresh budget
    And the other process names' dead messages stay dead
    And the audit trail records the act with how many messages it moved

  @integration
  Scenario: Every dead letter shown can be discarded in one act
    Given dead messages belonging to several process names
    When the operator discards all dead letters for one process name
    Then that process name's dead messages are marked discarded
    And the other process names' dead messages stay dead
    And the audit trail records the act with how many messages it marked

  # ── Attempt history ───────────────────────────────────────────────────

  # Reverses the v1 decision that the failure reason lives only on the span
  # and the log line: an operator reading a dead letter should not need
  # Grafana to learn why it died, and log retention is shorter than an
  # operator's questions. Failures only — a first-try success writes nothing,
  # so the table grows with trouble, not with traffic.

  @integration
  Scenario: Each failed delivery records why it failed
    Given an outbox message whose delivery fails twice and then dies
    When its attempt history is read
    Then it holds one entry per failed attempt, oldest first
    And each entry carries the attempt number, when it happened, and the failure diagnostic
    And the final entry is marked as the one that killed the message

  @unit
  Scenario: A recording failure never fails the delivery accounting
    Given an outbox delivery that fails while the attempt log is unavailable
    When the dispatcher records the failure
    Then the message still retries or dies exactly as it would have
    And the missing attempt entry is the only loss

  @integration
  Scenario: Attempt history dies with its message
    Given a dispatched outbox message with recorded attempts
    When the retention sweep removes the message
    Then its attempt entries are removed with it

  # A discarded row is terminal like a dead one, and no other family's
  # predicate matches it. Left out of the sweep it would be the one state that
  # never ages out, on the highest-volume table in the system.
  @integration
  Scenario: Discarded messages age out on the dead-letter window
    Given a discarded outbox row older than the dead retention window
    And a discarded outbox row inside the dead retention window
    When the dead-letter retention batch is reaped
    Then only the row past the window is deleted

  # Redrive resets the attempt counter, so the number stops being unique over
  # a message's life and only time orders the entries correctly.
  @integration
  Scenario: A redriven message keeps the history of both its lives
    Given a message that failed, was redriven, and failed again
    When its attempt history is read
    Then every failure from both lives is present
    And they read in the order they happened

  @unit
  Scenario: A dead letter shows why it died without leaving the page
    Given a dead message with recorded attempts
    When its row is expanded
    Then the attempts read oldest to newest, each with its failure diagnostic

  # ── Discard: the GroupQueue DLQ ───────────────────────────────────────

  # The Redis substrate already forgets DLQ entries after their TTL, so the
  # retained mark lives in the operator audit trail rather than on the entry.

  @integration
  Scenario: Discarding a DLQ group removes it and remembers the act
    Given a queue with a group in its dead-letter queue
    When the operator discards the group
    Then the group's jobs never run again
    And the audit trail records the queue, the group, how many jobs it held, and its last error

  @integration
  Scenario: A discarded DLQ group cannot be redriven afterwards
    Given a DLQ group the operator has discarded
    When a redrive of that queue's dead letters runs
    Then the discarded group is not among the redriven

  @unit
  Scenario: Bulk DLQ actions act on exactly what is shown
    Given the dead-letter list is narrowed by a filter
    When the operator applies a bulk redrive or discard
    Then only the groups that matched the filter are acted on
    And the confirmation states how many groups that is

  # ── One vocabulary ────────────────────────────────────────────────────

  @unit
  Scenario: Recovery verbs are the same on both substrates
    Given both dead-letter surfaces render their controls
    Then returning a dead letter to its queue is called redrive everywhere
    And marking one as never-to-be-sent is called discard everywhere
    And replay stays reserved for projection rebuilds

  # ── The headline number ───────────────────────────────────────────────

  @unit
  Scenario: The dashboard's dead-letter figure covers both substrates
    Given dead letters exist in the GroupQueue DLQ and the process outbox
    When the ops dashboard's stat strip renders
    Then the dead-letters statistic is the total across both
    And it states how many come from each
