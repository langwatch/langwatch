Feature: PullerAdapter framework contract
  As a platform engineer adding support for a new pull-mode ingestion source
  (S3 NDJSON drop, audit-log REST API, custom polling endpoint, etc.)
  I want a stable adapter contract — interface, lifecycle, error handling,
  cursor semantics — that I can implement against
  So that pull-mode ingestion is universal: the BullMQ worker + the admin UI
  + the CH ingest path are the same regardless of source-type

  Inspired by Singer Tap / Airbyte CDK / Apache Camel / Kafka Connect — pull
  side. Spec maps to Phase 10 backend (Sergey: P10-adapter-iface).

  Background:
    Given the LangWatch governance ingest pipeline accepts events under the unified `/governance/ingest/*` substrate

  Scenario: Adapter interface shape
    Given a class extends the `PullerAdapter` base
    Then it MUST implement:
      | Method                     | Returns                                                               |
      | id                         | string (stable adapter identifier, e.g. "http_polling")               |
      | validateConfig(config)     | zod schema validation; throws on bad config                           |
      | runOnce({ cursor })        | Promise<PullResult>                                                   |
    And `PullResult` MUST be `{ events: NormalizedEvent[], cursor: string \| null, errorCount: number }`

  Scenario: Cursor-based pagination is mandatory
    Given a puller for "acme" runs at 2026-05-03T10:00:00Z and persists `cursor = "2026-05-03T10:00:00Z"` in `IngestionSource.lastCursor`
    When the puller restarts (worker crash, container redeploy, etc.) and the next scheduled run fires
    Then `runOnce({ cursor: "2026-05-03T10:00:00Z" })` is called with the persisted cursor
    And the adapter resumes pulling from where it left off (no missed events, no duplicates beyond the source's own at-least-once guarantees)

  Scenario: Adapter is restart-safe
    Given a puller is mid-run when its BullMQ worker is killed
    When the worker comes back up + the job is re-scheduled
    Then the new run uses the LAST PERSISTED cursor (not in-memory cursor; the in-flight run's events were never persisted because runOnce hadn't returned)
    And no events are dropped (worst case = small re-pull window if source is at-least-once)

  Scenario: Bad config rejected at validate time, not at runtime
    Given an admin creates an IngestionSource with `pullConfig = { url: "not-a-url" }`
    When the adapter's `validateConfig({ url: "not-a-url" })` runs
    Then it throws a ZodError BEFORE the source is persisted
    And the admin sees a clear "Invalid pullConfig: url must be a valid URL" inline error
    And no IngestionSource row lands in PG with the broken config

  Scenario: Adapter errors don't crash the worker
    Given the adapter's `runOnce()` throws a transient network error
    When the worker handles the rejection
    Then the error is logged + captureException'd to PostHog
    And `IngestionSource.errorCount` increments
    And the cursor is NOT advanced (next run retries from the same cursor)
    And the worker remains alive to handle other puller jobs

  Scenario: NormalizedEvent shape is canonical across all adapters
    Given any adapter returns a PullResult
    Then every event in `events: NormalizedEvent[]` MUST conform to:
      | Field           | Type                          |
      | source_event_id | string (adapter-specific)     |
      | event_timestamp | ISO 8601 string               |
      | actor           | string (e.g. user email)      |
      | action          | string (e.g. "completion")    |
      | target          | string (e.g. model name)      |
      | cost_usd        | number (0 if unknown)         |
      | tokens_input    | number (0 if unknown)         |
      | tokens_output   | number (0 if unknown)         |
      | raw_payload     | string (full original event)  |
    And the worker handoff to the trace-store ingest path doesn't care which adapter produced the event
