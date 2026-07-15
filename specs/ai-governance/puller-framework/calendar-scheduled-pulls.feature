# Spec: the pull-mode ingestion puller is scheduled by the durable calendar
# scheduler (ADR-044 `ScheduledJob`) and executed on the event-sourcing
# GroupQueue. Cron SYNTAX is kept (it is a good way to express a schedule),
# but recurrence is owned by a Postgres-durable calendar row per source — NOT
# by Linux cron, NOT by BullMQ, and NOT by a self-re-arming delayed job.
#
# Pairs with:
#   - langwatch/ee/governance/services/pullers/ingestionPullScheduler.ts (calendar sync + fire handler + pull job)
#   - langwatch/ee/governance/services/pullers/pullerWorker.ts (the pull body, unchanged)
#   - langwatch/src/server/app-layer/scheduler/ (the generic calendar scheduler, ADR-044)
#   - langwatch/prisma/schema.prisma (IngestionSource.pullSchedule, ScheduledJob)
#
# Backstory: pull-mode ingestion sources poll external provider audit-log
# APIs on a recurring schedule expressed as a cron string (`pullSchedule`).
# That recurrence used to be a BullMQ repeatable job. The first replacement
# was a self-re-arming delayed job on the event-sourcing queue; ADR-044 §4
# rejected that pattern (Redis volatility, silent chain-break) and shipped a
# generic durable calendar instead. The puller now registers as a calendar
# consumer: one `ScheduledJob` row per pull-mode source owns WHEN a pull
# fires, and a due fire enqueues the pull onto the event-sourcing GroupQueue,
# which owns HOW it runs (per-source serialization, bounded concurrency).
# Because pulls are cursor-based, a fire is a self-contained "catch up from
# the cursor" — a missed slot delays data, never loses it.

Feature: Calendar-scheduled pull-mode ingestion sources
  As the platform
  I want pull-mode ingestion source recurrence owned by durable ScheduledJob
  calendar rows and executed on the event-sourcing queue
  So that recurring pulls survive Redis loss and worker restarts with no
  BullMQ, no Linux cron, and no self-re-arming job chain

  Background:
    Given the event-sourcing global queue is available
    And an organization with a hidden governance project

  @integration
  Scenario: Saving a source with a schedule creates its calendar entry
    Given a new pull-mode source is created with `pullSchedule = "*/10 * * * *"`
    When the create mutation succeeds
    Then a ScheduledJob calendar row exists for the source
    And its next fire is the cron expression's next instant
    And no BullMQ queue is created for ingestion pulls

  @integration
  Scenario: Worker boot repairs sources missing a calendar entry
    Given an active pull-mode source with a schedule but no calendar row
    When the boot-time reconcile pass runs
    Then a ScheduledJob calendar row is created for the source
    And a source that already has a calendar row is left untouched

  @integration
  Scenario: Updating the pull schedule reschedules the calendar entry
    Given an active pull-mode source with a calendar row
    When its `pullSchedule` is changed through the source update service
    Then the source keeps exactly one calendar row
    And that row carries the new cron expression and its next fire instant

  @integration @unit
  Scenario: Malformed schedules are rejected without touching the calendar
    Given an active pull-mode source with a valid calendar row
    When an update supplies a malformed `pullSchedule`
    Then the update is rejected before the malformed schedule is persisted
    And the existing calendar row remains unchanged

  @integration
  Scenario: Disabling or archiving a source deactivates its calendar entry
    Given an active pull-mode source with a calendar row
    When the source is disabled or archived
    Then its calendar row is deactivated so the due-scan skips it

  @integration
  Scenario: Re-enabling a disabled source reactivates its calendar entry
    Given a disabled pull-mode source with a deactivated calendar row
    When the source is re-enabled
    Then its calendar row is active again with a fresh next fire instant

  @integration
  Scenario: A due calendar fire enqueues the pull onto the event-sourcing queue
    Given an active pull-mode source with a calendar row
    When the source's calendar fire is handled
    Then an ingestion-pull job is staged on the event-sourcing queue
    And the adapter `runOnce` is invoked for the source
    And the source cursor is advanced

  @integration
  Scenario: A due pull runs the existing pull body and writes OCSF events
    Given a fixture audit-log adapter returning 1 event
    When the ingestion-pull job becomes due and is processed
    Then the adapter `runOnce` is invoked for the source
    And one row lands in `governance_ocsf_events` for the source's hidden governance project
    And the source cursor is advanced

  @integration
  Scenario: A fire for a source that is no longer schedulable stops the recurrence
    Given the source is archived after its calendar row was created
    When its calendar fire is handled
    Then the pull body does not run
    And the source's calendar row is deactivated

  @integration
  Scenario: Per-source serialization prevents overlapping pulls
    Given a pull body that takes longer than the gap to the next fire
    When the next pull becomes due while the current one is still running
    Then the next pull waits for the running pull to finish before starting

  @integration
  Scenario: Global pull concurrency is bounded across sources
    Given more due pull-mode sources than the pull concurrency limit
    When their ingestion-pull jobs all become due at the same time
    Then no more than the concurrency limit of pull bodies run at once
    And every source's pull still runs once the bulkhead drains

  @unit
  Scenario: Pull schedules are validated as five-field cron expressions
    Given a `pullSchedule` value
    When the source service validates it
    Then a five-field cron expression is accepted
    And garbage and seconds-resolution six-field expressions are rejected

  @unit
  Scenario: Scheduling uses the durable calendar, not Linux cron or BullMQ
    Given the puller scheduling module
    When its implementation is inspected
    Then it schedules through ScheduledJob calendar rows evaluated with croner
    And nothing is registered with Linux cron or a BullMQ repeatable job
