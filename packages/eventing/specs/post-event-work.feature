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

  # The publisher above reports the loss. The projection router, which
  # dispatches after a fold has already committed, takes the other side of the
  # same trade: it cannot report a loss to anyone, so it must not create one.
  @unit
  Scenario: A failing relevance guard never drops a side effect
    Given a subscriber whose relevance guard throws
    When the projection router dispatches an applied event to it
    Then the subscriber's work is enqueued anyway rather than dropped

  # Subscribers were called reactors. The vocabulary changed; the queue names
  # and the job registry keys did not, so work staged by the old build still
  # finds its handler on the new one.
  @unit
  Scenario: A registration keeps its queue identity across the vocabulary change
    Given a side effect registered as a subscriber under a parent projection
    When its subscriber queues are initialized
    Then the job registry key and the group key still name the old registration
    And the group key names the parent projection as well as the tenant

  @unit
  Scenario: An event subscriber receives no projection state
    Given an event subscriber for an accepted event
    When the event is durably appended and published
    Then the subscriber receives the event and event context
    And it receives no projection document

  @integration @subscriber @idempotency
  Scenario Outline: Subscriber redelivery does not repeat its action
    Given a <subscriber> subscriber performs an externally visible action for a source event
    And its action identity is stable for the subscriber action and source event identity
    When the handler completes the action but queue acknowledgement is lost
    And the same source event is delivered to that handler again
    Then the target contains one externally visible result for that action identity
    And the redelivered handler completes without repeating the action

    Examples:
      | subscriber |
      | event      |
      | projection |

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
