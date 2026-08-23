# See ../adrs/20260820-eventing-framework-boundary.md
Feature: Post-event work

  Event subscribers observe committed events. Projection subscribers observe
  the exact state committed by a named projection. Process managers consume
  committed events through a durable inbox and emit retry-safe intent through
  their outbox.

  @unit
  Scenario: A subscriber fires only after its projection commits
    Given a projection subscriber attached to a fold projection
    And an event for its aggregate
    When the projection successfully stores the next state
    Then the subscriber is dispatched asynchronously
    And it receives the event and exact committed state

  @unit
  Scenario: A projection failure prevents the side effect
    Given a projection subscriber attached to a fold projection
    And an event for its aggregate
    When the projection fails to store its next state
    Then the subscriber is not dispatched
    And the event remains on the projection's retry path

  @unit
  Scenario: An irrelevant event is rejected before any job is queued
    Given a subscriber that declares which events it accepts
    And an event it does not accept
    When the event is published
    Then no work is enqueued for that subscriber
    And its handler never receives the event

  @unit
  Scenario: A subscriber without a relevance guard fires for every event
    Given a subscriber with no relevance guard
    When an event is published
    Then work is enqueued for that subscriber

  @unit
  Scenario: A failing relevance guard is reported as a publish failure
    Given a subscriber whose relevance guard throws
    When an event is published
    Then the guard failure is reported
    And no subscriber work is counted as queued

  @unit
  Scenario: An event subscriber receives no projection state
    Given an event subscriber for an accepted event
    When the event is durably appended and published
    Then the subscriber receives the event and event context
    And it receives no projection document

  @unit
  Scenario: A throttled subscriber fires at most once per window
    Given a subscriber throttled to one firing per window
    When accepted events for the same identity arrive continuously
    Then the subscriber fires once per window with the newest payload
    And the window deadline stays anchored to the event that opened it

  @unit
  Scenario: A process manager redelivery does not evolve state twice
    Given a process manager has committed an event to its inbox and state
    When the same event is delivered again
    Then its transition is not applied again
    And its intent outbox contains no duplicate message key

  @unit
  Scenario: Replay never re-runs side effects
    Given committed events are replayed into selected projections
    When the replay applies them
    Then no event subscriber or projection subscriber is staged
    And no process manager consumes the replay delivery
