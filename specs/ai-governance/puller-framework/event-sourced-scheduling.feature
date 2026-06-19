# Spec: the pull-mode ingestion puller is scheduled by the in-house
# event-sourcing system. Cron SYNTAX is kept (it is a good way to express a
# schedule), but it is parsed in-process and fired by the event-sourcing
# scheduler, NOT by Linux cron and NOT by BullMQ.
#
# Pairs with:
#   - langwatch/ee/governance/services/pullers/ingestionPullScheduler.ts (registerJob + re-arm + seed)
#   - langwatch/ee/governance/services/pullers/pullerWorker.ts (the pull body, unchanged)
#   - langwatch/src/server/event-sourcing/services/queues/queueManager.ts (registerJob primitive)
#   - langwatch/prisma/schema.prisma (IngestionSource.pullSchedule)
#
# Backstory: pull-mode ingestion sources poll external provider audit-log
# APIs on a recurring schedule expressed as a cron string (`pullSchedule`).
# That recurrence used to be a BullMQ repeatable job. BullMQ is being removed
# in favour of the in-house event-sourcing system: the cron string is parsed
# in-process (cron-parser) to compute the next fire time, and a self-re-arming
# event-sourcing scheduled job fires at that time on the same durable queue
# everything else uses.

Feature: Event-sourced scheduling for pull-mode ingestion sources
  As the platform
  I want pull-mode ingestion sources driven by event-sourcing scheduled jobs
  So that recurring pulls run with no BullMQ and no Linux cron, on the same
  durable queue everything else uses

  Background:
    Given the event-sourcing global queue is available
    And an active pull-mode IngestionSource with `pullSchedule = "*/15 * * * *"`

  @integration
  Scenario: A pull-mode source is seeded onto the event-sourcing queue at worker start
    When the worker process starts
    Then exactly one ingestion-pull job is staged for the source on the event-sourcing queue
    And no BullMQ queue is created for ingestion pulls

  @integration
  Scenario: Seeding is idempotent across restarts and duplicate calls
    Given the source already has a pending ingestion-pull job
    When the seeder runs again
    Then the source still has exactly one pending ingestion-pull job

  @integration
  Scenario: A due pull runs the existing pull body and writes OCSF events
    Given a fixture audit-log adapter returning 1 event
    When the ingestion-pull job becomes due and is processed
    Then the adapter `runOnce` is invoked for the source
    And one row lands in `governance_ocsf_events` for the source's hidden governance project
    And the source cursor is advanced

  @integration
  Scenario: Each pull re-arms the next pull at the cron expression's next fire time, before doing the work
    When the ingestion-pull job is processed
    Then a follow-up ingestion-pull job for the same source is staged to dispatch at the cron expression's next fire time
    And the follow-up is staged before the pull body runs, so a crash mid-pull still leaves the next pull scheduled

  @integration
  Scenario: Per-source serialization prevents overlapping pulls
    Given a pull body that takes longer than the gap to the next fire
    When the next pull becomes due while the current one is still running
    Then the next pull waits for the running pull to finish before starting

  @integration
  Scenario: Archiving or disabling a source stops the recurrence
    Given the source is archived
    When its in-flight ingestion-pull job is processed
    Then the pull body does not run
    And no follow-up ingestion-pull job is staged for the source

  @integration
  Scenario: Saving a source with a schedule seeds it immediately
    Given a new pull-mode source is created with `pullSchedule = "*/10 * * * *"`
    When the create mutation succeeds
    Then an ingestion-pull job is staged for the new source without waiting for a worker restart

  @unit
  Scenario: The cron schedule is parsed in-process and fired by event-sourcing, not Linux cron
    Given a source with `pullSchedule = "*/15 * * * *"`
    When the scheduler computes when the next pull should fire
    Then it parses the cron expression in-process with cron-parser
    And the delay equals the next fire time minus now
    And nothing is registered with Linux cron or a BullMQ repeatable job

  @unit
  Scenario Outline: The next fire time is derived from the cron expression
    Given the current time is "<now>"
    And a source with `pullSchedule = "<cron>"`
    When the scheduler computes the next fire time
    Then it is "<next>"

    Examples:
      | now                  | cron          | next                 |
      | 2026-06-19T10:00:00Z | */15 * * * *  | 2026-06-19T10:15:00Z |
      | 2026-06-19T10:07:00Z | */15 * * * *  | 2026-06-19T10:15:00Z |
      | 2026-06-19T10:30:00Z | 0 * * * *     | 2026-06-19T11:00:00Z |
