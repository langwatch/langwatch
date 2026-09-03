Feature: Map Projections

  Map projections are stateless transformations that turn individual events into
  stored records. They are used for simple storage of denormalized event data.

  Background:
    Given a registered map projection "spanStorage" for aggregate type "trace"

  Scenario: Event transformation
    When a "span_received" event arrives
    Then the "map(event)" function is called
    And the resulting record is appended to the store

  Scenario: Skipping events
    When an event arrives that the map projection is not interested in
    And the "map(event)" function returns null
    Then no record is appended to the store

  Scenario: Parallel processing
    Given multiple events arrive for various aggregates
    When they are dispatched to the simple projection queue
    Then events are processed independently and potentially in parallel
    And no cross-event ordering is guaranteed or required
