Feature: PG orphan sweep for retention-deleted traces
  As the system
  I clean up PostgreSQL records that reference ClickHouse traces deleted by retention
  So that users never see stale references to expired data

  Background:
    Given the project has 30-day retention for traces
    And trace "old-trace" was ingested 35 days ago and has been deleted by retention TTL

  Scenario: Read-time lazy cleanup filters orphaned annotations
    Given an Annotation exists for trace "old-trace"
    When the user loads the annotations list
    Then the annotation for "old-trace" is excluded from the response
    And the orphaned Annotation is asynchronously deleted from PostgreSQL

  Scenario: Read-time lazy cleanup filters orphaned annotation queue items
    Given an AnnotationQueueItem exists for trace "old-trace"
    When the user loads the annotation queue
    Then the queue item for "old-trace" is excluded from the response
    And the orphaned AnnotationQueueItem is asynchronously deleted from PostgreSQL

  Scenario: Read-time cleanup nullifies TriggerSent trace reference
    Given a TriggerSent record references trace "old-trace"
    When the user loads the trigger history
    Then the TriggerSent record is shown without a trace link
    And the traceId field is set to NULL to preserve alert history

  Scenario: Read-time cleanup removes orphaned PublicShare
    Given a PublicShare exists for trace "old-trace"
    When a user accesses the shared link
    Then the share returns a data-expired message
    And the orphaned PublicShare is asynchronously deleted

  Scenario: Ingestion reactor triggers proactive orphan sweep
    Given tenant data was ingested 30 days ago with retention = 30
    When a new trace is ingested for the same tenant today
    Then the ingestion reactor detects the pending expiry window has passed
    And it proactively checks for orphaned PG records for this tenant
    And any orphaned Annotations, AnnotationQueueItems, and PublicShares are cleaned up

  Scenario: Tenant with no new ingestion relies on read-time cleanup
    Given a tenant stopped ingesting 60 days ago
    And their old traces have been deleted by retention
    When the tenant accesses their annotations list
    Then orphaned annotations are cleaned via read-time lazy cleanup
    And no ingestion reactor fires because there is no new ingestion

  Scenario: Orphan sweep processes one tenant at a time
    When the orphan sweep runs for a tenant
    Then it processes batches of 1000 TraceIds
    And it only queries data within the tenant's projectId scope
