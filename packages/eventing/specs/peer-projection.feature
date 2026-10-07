Feature: A module folds and maps a peer pipeline's events into its own state

  A peer projection is declared on the hosting module's own pipeline and names the owner's events
  by the owner contract's types and data schemas, so the owner changes nothing and the only edge
  runs from the host to the owner's contract (dev/docs/ARCHITECTURE.md sections 5 and 9). It rides
  the global registry with a local projection's guarantees: ordered per source aggregate, deduped by
  event id, re-folded and replayed from the owner's event log, which the host holds no copy of.

  @unit
  Scenario: A peer fold folds the owner's events per source aggregate
    Given a module declares a peer fold over the owner's span event
    When the owner's pipeline appends events for two aggregates
    Then each aggregate's state holds only its own events, in order
    And each event's data was parsed with the contract's schema

  @unit
  Scenario: An out-of-order owner event re-folds from the owner's event log
    Given a peer fold has folded an aggregate's earlier and later events
    When an event between them arrives late
    Then the fold re-reads the aggregate's history from the owner's event log
    And the state holds every event in business-time order

  @unit
  Scenario: A redelivered owner event folds once
    Given a peer fold has folded an owner event
    When the same event is delivered again
    Then the state is unchanged and records the event once

  @unit
  Scenario: A peer projection over an event no registered pipeline declares is refused
    Given a module declares a peer fold over an owner event
    And no registered pipeline declares that event type
    When the global registry starts routing
    Then it is refused naming the peer lane and the unknown event type

  @unit
  Scenario: A peer projection consuming an event it did not name is refused
    Given a module declares a peer fold whose event types include one it named no schema for
    When the pipeline is declared
    Then the declaration is refused naming the lane and the unnamed type

  @unit
  Scenario: A peer map maps the owner's events, parsed by the contract
    Given a module declares a peer map over the owner's span event
    When the owner's pipeline appends that event
    Then the host's store is handed the record mapped from the parsed data

  @unit
  Scenario: A projection replay rebuilds a peer projection from the owner's events
    Given a module declares a peer fold and a peer map over the owner's events
    When a projection replay reads the registered pipelines
    Then it lists both lanes under the owner's aggregate type, paused on the global pipeline
    And it folds the owner's stored events through the contract's schema as live delivery does
