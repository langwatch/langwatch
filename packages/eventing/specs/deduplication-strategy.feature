Feature: Deduplication Strategy for Event Processing

  The event-sourcing library supports configurable deduplication strategies
  to control how events and commands are batched and deduplicated before processing.

  Background:
    Given an event sourcing pipeline with handlers

  # Default behavior

  Scenario: Default behavior processes every event
    When a handler is configured without explicit deduplication
    Then every event is processed individually
    And no deduplication ID is generated

  # Aggregate deduplication (shorthand)

  Scenario: Aggregate deduplication batches events by aggregate
    When a handler is configured with deduplication: "aggregate"
    And multiple events arrive for the same aggregate within the TTL
    Then events are deduplicated by tenantId:aggregateType:aggregateId
    And only the latest event triggers processing

  # Custom deduplication

  Scenario: Custom deduplication uses provided ID function
    When a handler is configured with custom deduplication config
      | makeId | (event) => event.tenantId + ':' + event.type |
      | ttlMs  | 500                                          |
    And the custom makeId function returns a specific ID
    Then events with the same custom ID are deduplicated within 500ms
    And events with different custom IDs are processed separately

  Scenario: Custom deduplication with extended TTL
    When a handler is configured with deduplication extending enabled
      | extend | true |
      | ttlMs  | 200  |
    And events arrive at 0ms, 100ms, and 250ms for the same ID
    Then the TTL resets on each new event
    And only the final event is processed after 450ms

  # Type safety

  Scenario: Aggregate deduplication requires tenantId in payload
    Given a command handler payload type without tenantId
    When configuring the handler with deduplication: "aggregate"
    Then a compile-time type error indicates tenantId is required
