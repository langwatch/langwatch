Feature: Subscriber staging carries only relevant bounded work

  A subscriber decides relevance before staging. Work that is relevant carries
  the smallest sufficient typed representation: a reference, a bounded
  derivation, or an already-small body.

  Background:
    Given a subscriber that needs only a small derived slice of each relevant event

  @unit
  Scenario: a non-matching event never mints a job
    Given the subscriber declares which events are relevant to it
    And an event the subscriber considers not relevant
    When the event is published
    Then no work is queued for that subscriber
    And the subscriber never processes that event

  @unit
  Scenario: a matching event mints a job for the subscriber
    Given an event the subscriber considers relevant
    When the event is published
    Then work is queued for that subscriber

  @unit
  Scenario: a redelivered event resolves to the unit of work already queued
    Given a relevant event already queued for the subscriber
    When the same event is published again within the deduplication window
    Then it resolves to the same unit of work, so the queue recognises it as a duplicate
    And an event on another aggregate never resolves to that same unit

  @unit
  Scenario: two relevant events that share no payload identity are still delivered separately
    Given two distinct relevant events on the same aggregate
    And neither carries an identity of its own within that aggregate
    When both are published within the deduplication window
    Then each is queued as its own unit of work
    And neither event's facts are dropped in favour of the other's

  @unit
  Scenario: a subscriber that cannot decide relevance is reported, not read as declining
    Given a relevant event the subscriber errors on while deciding relevance
    When the event is published
    Then publishing reports the failure
    And no work is queued for that subscriber
    And the failure is distinguishable from the event having been considered irrelevant

  @unit
  Scenario: a subscriber that cannot decide relevance loses only its own work
    Given two subscribers observing the same event
    And the first subscriber errors while deciding relevance
    When the event is published
    Then the second subscriber still receives the event
    And the other events published alongside it still reach their subscribers

  @unit
  Scenario: a subscriber that cannot decide relevance never fails the write behind it
    Given a recorded event the subscriber errors on while deciding relevance
    When the recording completes
    Then the record is kept
    And the failure is reported to operators
    And nothing retries that subscriber for that event

  @unit
  Scenario: enqueue outcomes are visible to operators
    Given a stream of relevant and irrelevant events
    When they are published
    Then an operator-visible count distinguishes events discarded as irrelevant from events queued as work

  @unit
  Scenario: work that never reaches the queue is not counted as queued
    Given an event the subscriber considers relevant
    And the subscriber's queue is unavailable
    When the event is published
    Then publishing reports the failure
    And the event is not counted among the work queued

  @unit
  Scenario: work lost before it was queued is visible as lost
    Given a subscriber that cannot decide relevance
    When the event is published
    Then an operator-visible count records the work as lost
    And the counted outcomes account for every event routed to that subscriber

  @unit
  Scenario: a subscriber can be stopped for one tenant without a deploy
    Given an operator has stopped one subscriber for one tenant
    When an event for that tenant is published
    Then the subscriber neither judges the event nor receives work for it
    And no event is recorded as discarded on that tenant's behalf

  @unit
  Scenario: relevant work waits in the queue at the cost of a pointer, not of its payload
    Given a relevant event whose payload is large
    When the event is published
    Then the queued work holds only enough to find the payload again
    And the subscriber still produces exactly the result the whole payload would have produced
    And a redelivery of that event still collapses to one unit of work

  @unit
  Scenario: work whose payload is not readable yet retries, never drops
    Given queued work whose payload has not yet landed where the subscriber reads it
    When the subscriber processes that work
    Then the attempt fails into the queue's retry
    And the work completes once the payload becomes readable

  @unit
  Scenario: work a build cannot read fails loudly, never half-processed
    Given queued work in a shape this build does not recognise
    When the subscriber processes it
    Then the attempt fails into the queue's retry
    And the work is never mistaken for a shape the build does know

  @unit
  Scenario: an event the subscriber declines is still completed quietly
    Given queued work carrying an event of a kind this build does know
    And the subscriber considers that event not relevant
    When the subscriber processes it
    Then the work completes without producing a result
    And the attempt does not fail into the queue's retry

  @unit
  Scenario: work whose result is a bounded derivation carries it instead of a pointer
    Given a relevant event whose payload is large
    And the subscriber's whole result is a derivation drawn from a fixed, closed vocabulary
    When the event is published
    Then the queued work carries that derivation
    And the queued work does not grow with the size of the payload it came from
    And the subscriber produces its result without reading the payload back

  @unit
  Scenario: work carrying its finished result completes without reading anything back
    Given queued work that carries the subscriber's finished result
    When the subscriber processes that work
    Then the result is delivered as it was carried
    And the payload's store is never read

  @unit
  Scenario: a carried derivation never carries content
    Given an event whose payload contains large content alongside small facts
    When the subscriber's result is derived from that event
    Then the derivation holds the small facts
    And the derivation holds none of the content
    And the content remains readable from the payload's canonical store

  @unit
  Scenario: an event whose payload cannot be pointed at is still processed
    Given a relevant event that carries no identity to find its payload by
    When the event is published
    Then the queued work carries the typed event
    And the subscriber reaches the same outcome as a referenced payload

  @unit
  Scenario: a failure preparing queued work is reported, never hidden behind the whole payload
    Given a relevant event the subscriber errors on while preparing its queued work
    When the event is published
    Then publishing reports the failure
    And the subscriber never processes that event
