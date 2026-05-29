# Update trace metadata via API after creation.
#
# Customers need to attach or modify metadata (labels, user_id, customer_id,
# thread_id, custom keys) on traces after they've been ingested. Today
# metadata can only be set during span ingestion or via the SDK's
# trace.update() workaround. This feature adds a first-class
# ChangeTraceMetadataCommand to the event-sourcing pipeline, exposed as
# a tRPC mutation and documented in the public API reference.
#
# Key design decisions surfaced during challenge review:
# - Labels set via API use REPLACE semantics (not union-merge), protected
#   by a `labelsUserOverridden` latch so late-arriving spans don't clobber.
# - Reserved fields (user_id, customer_id, thread_id) are protected by the
#   existing state-wins spread order in accumulateAttributes.
# - Each API call gets a unique makeJobId (includes timestamp) to prevent
#   queue coalescing from swallowing partial metadata updates.
# - Mutation validates trace existence before dispatching to prevent ghost
#   traces with spanCount=0 appearing in the trace list.
# - Individual metadata values are capped at 4KB, total payload at 32KB.

Feature: Update trace metadata by trace ID
  As an API consumer
  I want to update a trace's metadata after it has been created
  So that I can attach labels, user identity, and custom metadata from
  backend processes that resolve after trace ingestion.

  Background:
    Given a project with an authenticated API key or user session
    And a trace exists with traceId "trace-abc"
    And the trace has existing attributes:
      | key                  | value          |
      | langwatch.user_id    | original-user  |
      | langwatch.labels     | ["production"] |
      | metadata.team        | platform       |

  # ─── Command & Event Schema ────────────────────────────────────────────

  @unit
  Scenario: ChangeTraceMetadataCommand produces a TraceMetadataChangedEvent
    When the command is dispatched with:
      | field            | value                                      |
      | traceId          | trace-abc                                  |
      | metadata         | { "user_id": "new-user", "labels": ["qa"] }|
      | changedByUserId  | user-123                                   |
    Then a "lw.obs.trace.trace_metadata_changed" event is persisted
    And the event data contains traceId, metadata, and changedByUserId

  @unit
  Scenario: Command rejects empty metadata object
    When the command is dispatched with an empty metadata object
    Then the command fails with a validation error

  @unit
  Scenario: Command rejects oversized metadata values
    When the command is dispatched with a metadata value exceeding 4KB
    Then the command fails with a validation error

  @unit
  Scenario: Command deduplicates identical metadata submissions
    When the same metadata payload is dispatched twice for the same trace
    Then only one event is persisted (idempotency key collision)

  @unit
  Scenario: Rapid partial updates are not coalesced
    When changeMetadata is called with { user_id: "a" } then 200ms later with { labels: ["x"] }
    Then both events are persisted independently (unique makeJobId per call)
    And the fold applies both: user_id is "a" AND labels is ["x"]

  # ─── Fold Projection: Deep Merge ───────────────────────────────────────

  @unit
  Scenario: Reserved field user_id is deep-merged into attributes
    When a TraceMetadataChangedEvent arrives with metadata.user_id = "new-user"
    Then state.attributes["langwatch.user_id"] is "new-user"
    And state.attributes["metadata.team"] is preserved as "platform"

  @unit
  Scenario: Reserved field customer_id is deep-merged into attributes
    When a TraceMetadataChangedEvent arrives with metadata.customer_id = "cust-99"
    Then state.attributes["langwatch.customer_id"] is "cust-99"
    And other attributes are preserved

  @unit
  Scenario: Reserved field thread_id is deep-merged into attributes
    When a TraceMetadataChangedEvent arrives with metadata.thread_id = "thread-42"
    Then state.attributes["gen_ai.conversation.id"] is "thread-42"

  @unit
  Scenario: Labels replace the existing labels array and set the override latch
    When a TraceMetadataChangedEvent arrives with metadata.labels = ["qa", "reviewed"]
    Then state.attributes["langwatch.labels"] is '["qa","reviewed"]'
    And state.labelsUserOverridden is true

  @unit
  Scenario: Late-arriving span does not clobber API-set labels
    Given a TraceMetadataChangedEvent has set labels to ["qa", "reviewed"]
    And state.labelsUserOverridden is true
    When a span arrives with langwatch.labels = ["production"]
    Then state.attributes["langwatch.labels"] remains '["qa","reviewed"]'
    And the span's labels are ignored because the latch is set

  @unit
  Scenario: Custom metadata keys are deep-merged with metadata prefix
    When a TraceMetadataChangedEvent arrives with metadata.environment = "staging"
    Then state.attributes["metadata.environment"] is "staging"
    And state.attributes["metadata.team"] is preserved as "platform"

  @unit
  Scenario: Custom metadata JSON objects are deep-merged
    Given the trace has attribute metadata.config = '{"retries": 3}'
    When a TraceMetadataChangedEvent arrives with metadata.config = {"timeout": 30}
    Then state.attributes["metadata.config"] is '{"retries":3,"timeout":30}'

  @unit
  Scenario: Metadata update does not affect non-metadata trace fields
    When a TraceMetadataChangedEvent arrives with metadata.user_id = "new-user"
    Then traceName, spanCount, totalDurationMs, and other summary fields are unchanged

  # ─── API Endpoint ──────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: tRPC mutation updates trace metadata successfully
    Given a user with "traces:update" permission
    When the user calls traces.changeMetadata with:
      | field     | value                                          |
      | projectId | project-1                                      |
      | traceId   | trace-abc                                      |
      | metadata  | { "user_id": "api-user", "labels": ["tagged"] }|
    Then the mutation returns success with the traceId
    And the trace summary in ClickHouse reflects the updated attributes

  @integration @unimplemented
  Scenario: Mutation rejects users without traces:update permission
    Given a user with only "traces:read" permission
    When the user calls traces.changeMetadata
    Then the request is rejected with a permission error

  @integration @unimplemented
  Scenario: Mutation rejects non-existent trace
    When the user calls traces.changeMetadata for a traceId that does not exist
    Then the mutation returns a "trace not found" error
    And no event is persisted

  # ─── Reactors ──────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Metadata update triggers trace broadcast reactor
    When a TraceMetadataChangedEvent is processed through the fold projection
    Then the traceUpdateBroadcastReactor fires
    And connected SSE clients receive a "trace_summary_updated" event

  # ─── Documentation ─────────────────────────────────────────────────────

  @unit
  Scenario: API documentation includes the changeMetadata endpoint
    Then the API reference documents the traces.changeMetadata mutation
    And the documentation includes:
      | section        | content                                           |
      | endpoint       | traces.changeMetadata                             |
      | permission     | traces:update                                     |
      | input schema   | projectId, traceId, metadata object               |
      | merge          | deep merge (new keys add, existing update, missing preserved) |
      | labels         | labels array replaces entirely on explicit update  |
      | audit          | changedByUserId recorded in event                 |
      | size limits    | 4KB per value, 32KB total payload                 |
      | namespace note | custom keys share namespace with SDK span metadata |
