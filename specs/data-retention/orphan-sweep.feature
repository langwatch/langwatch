Feature: PG orphan sweep for retention-deleted traces
  As the system
  I clean up PostgreSQL records that reference ClickHouse traces deleted by retention
  So that users never see stale references to expired data

  Background:
    Given the project has 30-day retention for traces
    And trace "old-trace" was ingested 35 days ago and has been deleted by retention TTL

  # ─────────────────────────────────────────────────────────────────────────
  # Self-perpetuating chain (BullMQ event chain — NOT a scheduled cron).
  # The reactor seeds it on first ingest; each chain step re-enqueues itself
  # with a 24h delay via the worker's `completed` listener. Stable per-tenant
  # jobId means bursty ingest folds into a single seed, and the canonical
  # 1-per-tenant-per-24h cadence is enforced by the jobId being held while a
  # chain step is in the queue.
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Ingestion seeds the per-tenant orphan-sweep chain
    Given the tenant has no orphan-sweep chain step in the queue
    When a trace event is ingested
    Then the ingestion reactor enqueues a chain step for this tenant
    And the chain step has a stable jobId of the form "orphan-sweep-chain:<tenantId>"

  Scenario: Concurrent ingest from the same tenant dedups to a single chain step
    Given a chain step is already queued for the tenant
    When multiple trace events from the same tenant are ingested in rapid succession
    Then no additional chain steps are created — the stable jobId dedups the adds
    And the existing chain step proceeds without interference

  Scenario: Chain step sweeps and re-enqueues itself for the next day
    Given a chain step has just completed for an active tenant
    When the worker's `completed` listener fires
    Then a follow-up chain step is enqueued with a 24h delay
    And the follow-up step uses the same per-tenant jobId

  Scenario: Chain stops when the project is archived
    Given the project's `archivedAt` is set
    When the next chain step runs
    Then no sweep is performed
    And the worker returns `stopChain: true` so no follow-up step is enqueued
    And the chain for this tenant ends until ingestion seeds a new one

  Scenario: Chain stops when the project has been hard-deleted
    Given the project row no longer exists in PostgreSQL
    When the next chain step runs
    Then no sweep is performed
    And the worker returns `stopChain: true` so no follow-up step is enqueued

  Scenario: Transient sweep failure does NOT break the chain
    Given the project is active
    And the sweep throws a transient PG error
    When the chain step completes
    Then the worker returns `stopChain: false`
    And the follow-up chain step is enqueued for 24h later
    And the next step gets another shot at the same tenant's orphans

  # ─────────────────────────────────────────────────────────────────────────
  # Per-step orphan cleanup behavior (what the sweep itself does).
  # ─────────────────────────────────────────────────────────────────────────

  Scenario: Chain step cleans orphaned annotations
    Given an Annotation exists for trace "old-trace"
    When the orphan-sweep chain step runs for the project
    Then the orphaned Annotation is deleted from PostgreSQL

  Scenario: Chain step cleans orphaned annotation queue items
    Given an AnnotationQueueItem exists for trace "old-trace"
    When the orphan-sweep chain step runs for the project
    Then the orphaned AnnotationQueueItem is deleted from PostgreSQL

  Scenario: Chain step nullifies TriggerSent trace reference
    Given a TriggerSent record references trace "old-trace"
    When the orphan-sweep chain step runs for the project
    Then the TriggerSent record's traceId is set to NULL to preserve alert history

  Scenario: Chain step removes orphaned PublicShare
    Given a PublicShare exists for trace "old-trace"
    When the orphan-sweep chain step runs for the project
    Then the orphaned PublicShare is deleted from PostgreSQL

  Scenario: Read-time lazy cleanup is still the read path's safety net
    Given a tenant accesses their annotations list before the next chain step runs
    Then orphaned annotations are excluded from the response at read time
    And the orphaned Annotation is asynchronously deleted from PostgreSQL

  Scenario: Chain step processes orphans in bounded batches scoped to the tenant
    When the orphan-sweep chain step runs for a tenant
    Then it processes candidate trace ids in pages of 1000
    And every query is filtered by the tenant's projectId
    And cross-tenant queries never appear in the sweep
