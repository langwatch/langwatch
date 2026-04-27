Feature: Private Dataplane Data Isolation

  When a customer has a private ClickHouse instance, ALL data flowing
  through the event-sourcing pipeline must land in the private instance.
  No data should leak to the shared instance or vice versa.

  This covers the full write path: trace ingestion → event store →
  projections (spans, logs, metrics, evaluations).

  Background:
    Given a shared ClickHouse instance (container A)
    And a private ClickHouse instance (container B)
    And org "private-org" is configured with the private instance via env var
    And org "shared-org" uses the shared instance (no private env var)

  # ---------------------------------------------------------------------------
  # Event-sourcing write path isolation
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Spans for a private-CH org go to the private instance only
    Given a project under org "private-org"
    When a span is ingested through the event-sourcing pipeline
    Then the span data exists in container B (private)
    And the span data does NOT exist in container A (shared)

  @integration
  Scenario: Spans for a shared-CH org go to the shared instance only
    Given a project under org "shared-org"
    When a span is ingested through the event-sourcing pipeline
    Then the span data exists in container A (shared)
    And the span data does NOT exist in container B (private)

  @integration
  Scenario: Events for a private-CH org are stored in the private instance
    Given a project under org "private-org"
    When events are stored via the EventStore
    Then the event_log rows exist in container B (private)
    And the event_log rows do NOT exist in container A (shared)

  @integration
  Scenario: Concurrent writes for different orgs route correctly
    Given a project under org "private-org" and a project under org "shared-org"
    When spans are ingested concurrently for both projects
    Then private-org spans are in container B only
    And shared-org spans are in container A only
