# Main's groupQueueMigrationAudit, read-only, owned by the queue framework.
Feature: Queue drain audit

  As a migration that must not move storage under in-flight jobs
  I want to ask the queue framework which queues still hold work
  So that a cutover refuses while any queue is not drained

  @unit
  Scenario: Drained queues report no blockers
    Given every registered queue has no pending, delayed, active or blocked work
    And no staged payload references the durable store
    When the drain audit runs
    Then it reports no blockers

  @unit
  Scenario: A queue holding work reports each non-empty count
    Given a queue with pending jobs, a delayed job, an active group and a blocked group
    When the drain audit runs
    Then it reports the pending, delayed, active and blocked counts for that queue
    And it skips the staged payload scan for that queue

  @unit
  Scenario: Staged payloads referencing the durable store block a quiet queue
    Given a queue with no live work whose staged data holds a payload stored in s3
    When the drain audit runs
    Then it reports one staged-durable-ref blocker for that queue

  @unit
  Scenario: Queues missing from the registry are still found by scan
    Given a queue whose ready key exists but which is not in the registry
    When the drain audit runs
    Then that queue is audited
