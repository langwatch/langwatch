Feature: A projection subscriber's job may queue a compact body

  A fold subscriber's queued job carries its event and the fold state it was armed with. A
  subscriber that needs only a few identifiers declares a compact job instead (ADR-069): a schema,
  a stage that derives the body from the delivery, and one handler for that body. Workers read
  both bodies before any worker queues the compact one, so the switch to queue it stays off until
  every worker reads it. Routing (group, score, deduplication) is still computed from the full
  delivery, so the deadline and deduplication do not change with the body.

  @unit
  Scenario: A full job still queued is staged into its compact body when it runs
    Given a fold subscriber that declares a compact job and queues the full delivery
    When an event folds and its job runs
    Then the handler receives the compact body derived from the event and fold state

  @unit
  Scenario: With the switch on, the queued job holds only the event's identity and the compact body
    Given a fold subscriber that declares a compact job and queues the compact body
    When an event folds
    Then the queued job carries neither the event's data nor the fold state
    And its deduplication id is the one the full delivery would have had
    And the handler receives the compact body when the job runs

  @unit
  Scenario: A compact body queued for a subscriber that reads none is refused
    Given a fold subscriber without a compact job
    When a job with a compact body reaches its lane
    Then the handler is never called
