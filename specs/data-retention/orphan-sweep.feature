Feature: PG orphan sweep for retention-deleted traces
  As the system
  I clean up PostgreSQL records that reference ClickHouse traces deleted by retention
  So that users never see stale references to expired data

  Background:
    Given the project has 30-day retention for traces
    And trace "old-trace" was ingested 35 days ago and has been deleted by retention TTL

  # ─────────────────────────────────────────────────────────────────────────
  # Self-perpetuating sweep (event-sourcing groupQueue command — NOT a cron).
  # The ingestion reactor dispatches a per-tenant sweep command on first ingest;
  # each increment self-dispatches the next one after the steady cadence. No
  # scheduler, no cron endpoint, no BullMQ. One sweep loop per tenant is
  # guaranteed by tenant-scoped deduplication, so bursty ingest folds into a
  # single loop. (ADR-024 supersedes the BullMQ chain of ADR-023.)
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Ingestion seeds the per-tenant orphan sweep
    Given the tenant has no orphan-sweep loop running
    When a trace event is ingested
    Then the ingestion reactor dispatches an orphan-sweep command for this tenant

  Scenario: Concurrent ingest from the same tenant folds into a single sweep loop
    Given an orphan-sweep loop is already running for the tenant
    When multiple trace events from the same tenant are ingested in rapid succession
    Then no additional sweep loop is started — tenant-scoped dedup folds them into one
    And the existing loop proceeds without interference

  Scenario: A sweep increment is bounded and resumes from its saved cursor
    When an orphan-sweep increment runs for a tenant
    Then it processes at most a bounded page budget of candidate trace ids
    And it persists a cursor so the next increment resumes where this one stopped

  Scenario: A sweep increment self-perpetuates the next one after the steady cadence
    Given an orphan-sweep increment has just completed for an active tenant
    Then the next increment is scheduled to run after the steady cadence
    And no scheduler, cron, or repeat job is involved — it is an event continuation

  Scenario: The sweep loop stops when the project is archived
    Given the project's `archivedAt` is set
    When the next sweep increment runs
    Then no sweep is performed
    And no follow-up increment is scheduled — the loop ends until ingestion restarts it

  Scenario: The sweep loop stops when the project has been hard-deleted
    Given the project row no longer exists in PostgreSQL
    When the next sweep increment runs
    Then no sweep is performed
    And no follow-up increment is scheduled

  Scenario: A transient sweep failure does NOT stop the loop
    Given the project is active
    And the sweep throws a transient PG error
    When the increment completes
    Then the next increment is still scheduled
    And the next increment gets another shot at the same tenant's orphans

  Scenario: Repeated failures stop the loop and surface the error
    Given the project is active
    And the sweep has failed on several consecutive increments
    When the failure count reaches the circuit-breaker threshold
    Then no further increment is scheduled
    And the condition is surfaced for investigation
    And the next ingest re-seeds a fresh loop

  # ─────────────────────────────────────────────────────────────────────────
  # Per-step orphan cleanup behavior (what the sweep itself does).
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Sweep increment cleans orphaned annotations
    Given an Annotation exists for trace "old-trace"
    When the orphan-sweep increment runs for the project
    Then the orphaned Annotation is deleted from PostgreSQL

  Scenario: Sweep increment cleans orphaned annotation queue items
    Given an AnnotationQueueItem exists for trace "old-trace"
    When the orphan-sweep increment runs for the project
    Then the orphaned AnnotationQueueItem is deleted from PostgreSQL

  Scenario: Sweep increment nullifies TriggerSent trace reference
    Given a TriggerSent record references trace "old-trace"
    When the orphan-sweep increment runs for the project
    Then the TriggerSent record's traceId is set to NULL to preserve alert history

  Scenario: Sweep increment removes orphaned PublicShare
    Given a PublicShare exists for trace "old-trace"
    When the orphan-sweep increment runs for the project
    Then the orphaned PublicShare is deleted from PostgreSQL

  # The sweep is the sole orphan-cleanup mechanism. There is no read-time
  # lazy cleanup wired into annotation lists, public shares, trigger history
  # or queue items today — between increments, stale rows can briefly
  # surface, and that's the accepted trade-off for the single, predictable
  # cadence. Reintroducing a read-time path would require touching every
  # consumer; if it ever returns it gets its own feature file.

  Scenario: Sweep increment processes orphans in bounded batches scoped to the tenant
    When the orphan-sweep increment runs for a tenant
    Then it processes candidate trace ids in pages of 1000
    And every query is filtered by the tenant's projectId
    And cross-tenant queries never appear in the sweep
