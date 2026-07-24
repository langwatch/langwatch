# Update trace metadata via API after creation.
#
# Customers need to attach or modify metadata (labels, user_id, customer_id,
# thread_id, custom keys) on traces after they've been ingested. Today
# metadata can only be set during span ingestion or via the SDK's
# trace.update() workaround.
#
# Key design decisions surfaced during challenge review:
# - Metadata updates are implemented as synthetic spans injected through the
#   standard ingestion pipeline — traces remain immutable per OTel spec,
#   and "updating" a trace means adding a span that carries the new attributes.
# - The existing accumulateAttributes pipeline handles all reserved-field
#   mapping (user_id → langwatch.user_id, labels → langwatch.labels, etc.)
#   and custom metadata prefixing (key → metadata.key).
# - No custom event type needed — reuses SpanReceivedEvent via recordSpan.
# - Individual metadata values are capped at 4KB, total payload at 32KB.
# - SDK exposes get(id).patch(...) which calls the REST PATCH endpoint.

Feature: Update trace metadata by trace ID
  As an API consumer
  I want to update a trace's metadata after it has been created
  So that I can attach labels, user identity, and custom metadata from
  backend processes that resolve after trace ingestion.

  Background:
    Given a project with an authenticated API key or user session
    And a trace exists with traceId "trace-abc"

  # ─── REST API Endpoint ─────────────────────────────────────────────

  @unit
  Scenario: PATCH endpoint injects a synthetic span with metadata as resource attributes
    When the user calls PATCH /traces/trace-abc/metadata with:
      | field    | value                                          |
      | metadata | { "user_id": "new-user", "labels": ["qa"] }   |
    Then a span is recorded via recordSpan for traceId "trace-abc"
    And the span resource contains langwatch.user.id = "new-user"
    And the span resource contains langwatch.labels = '["qa"]'

  @unit
  Scenario: PATCH endpoint rejects empty metadata object
    When the user calls PATCH /traces/trace-abc/metadata with an empty metadata object
    Then the request fails with a validation error

  @unit
  Scenario: PATCH endpoint rejects oversized metadata values
    When the user calls PATCH /traces/trace-abc/metadata with a value exceeding 4KB
    Then the request fails with a validation error

  @unit
  Scenario: PATCH endpoint maps reserved fields to resource attributes
    When the user calls PATCH /traces/trace-abc/metadata with:
      | field    | value                                                     |
      | metadata | { "user_id": "u1", "customer_id": "c1", "thread_id": "t1" } |
    Then the span resource contains langwatch.user.id = "u1"
    And the span resource contains langwatch.customer.id = "c1"
    And the span resource contains langwatch.thread.id = "t1"

  @unit
  Scenario: PATCH endpoint maps custom keys to langwatch.metadata.* resource attributes
    When the user calls PATCH /traces/trace-abc/metadata with:
      | field    | value                        |
      | metadata | { "environment": "staging" } |
    Then the span resource contains langwatch.metadata.environment = "staging"

  # ─── Attribute Pipeline (existing accumulateAttributes) ────────────

  @integration @unimplemented
  Scenario: Synthetic span attributes flow through accumulateAttributes correctly
    Given a synthetic metadata span with resource langwatch.user.id = "new-user"
    When the span is processed by the fold projection
    Then state.attributes["langwatch.user_id"] is "new-user"

  # ─── Documentation ─────────────────────────────────────────────────

  @unit
  Scenario: API documentation includes the metadata update endpoint
    Then the API reference documents the PATCH /traces/:traceId/metadata endpoint
    And the documentation includes:
      | section        | content                                           |
      | endpoint       | PATCH /traces/:traceId/metadata                   |
      | permission     | traces:update                                     |
      | input schema   | metadata object (user_id, customer_id, etc.)      |
      | mechanism      | synthetic span through standard ingestion pipeline |
      | size limits    | 4KB per value, 32KB total payload                 |
