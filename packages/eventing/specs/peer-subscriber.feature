Feature: A module reacts to a peer pipeline's events from its own side

  A peer subscriber is declared on the reacting module's own pipeline and names the owner's
  event by the owner contract's type and data schema, so the edge runs from the reacting module
  to the owner and never closes a cycle (dev/docs/ARCHITECTURE.md section 9). It rides the global
  registry: staged wherever the owner appends, delivered at least once, ordered per aggregate,
  re-driven through the hand-off outbox, never replayed.

  @unit
  Scenario: A module reacts to a peer pipeline's event from its own pipeline
    Given a module declares a peer subscriber on the owner's created event
    When the owner's pipeline appends that event, whichever pipeline registered first
    Then the subscriber is handed the event's data parsed with the contract's schema

  @unit
  Scenario: Several modules declare global lanes in one process
    Given one module declares a global map projection
    And another module declares a peer subscriber
    When the owner's pipeline appends an event both take
    Then both lanes receive it

  @unit
  Scenario: A global lane declared after routing started is refused by name
    Given the global registry started routing when consumers started
    When a later pipeline declares a peer subscriber
    Then registration is refused naming the subscriber's lane
