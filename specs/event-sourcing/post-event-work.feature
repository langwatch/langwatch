Feature: Work that happens after an event
  As someone whose data the platform derives things from
  I want everything derived from my events to be reproducible from those events
  So that a bad day for a worker is not a permanent wrong number on my bill,
  my audit trail, or my dashboard

  # See dev/docs/adr/075-post-event-work-subscribers-and-process-managers.md
  #
  # Replaces the former reactors.feature, deleted with the reactor itself.
  # That file specified a third kind of post-event handler; its scenarios
  # described a mechanism, whereas the ones here describe what a customer is
  # entitled to rely on regardless of mechanism.
  #
  # Two kinds of post-event work remain:
  #
  #   subscriber       — sees the event, nothing else. Self-idempotent.
  #   process manager  — durable state, deadlines, a leased outbox.
  #
  # State that anyone reads as fact is derived by a projection, which replay
  # rebuilds. The distinction that matters to a customer is not which of these
  # ran, but whether losing it is allowed to leave a permanent mark.
  #
  # Boundary against payload-cost.feature (ADR-069): that file owns the
  # ENQUEUE SEAM — which events mint a job at all, what a staged job costs in
  # bytes, and what happens when a relevance predicate throws. This file owns
  # the SUBSTRATE CHOICE — given that work is going to happen, which of the two
  # kinds runs it and what the customer is owed if it is lost. They meet at one
  # point worth knowing: a reactor's relevance guard fails OPEN, the enqueue
  # filter fails LOST, so a guard cannot simply be moved from one to the other.
  # ADR-075 "The one migration hazard" states the rule.
  #
  # ADR-075 is now executed: the reactor is gone, and every post-event
  # handler is a subscriber, a projection or a process manager.

  # ============================================================================
  # Derived facts are reproducible
  # ============================================================================

  @integration
  Scenario: A number someone reads as fact can be rebuilt from the events
    Given events that a derived figure is computed from
    When the figure is recomputed from those same events
    Then it matches the figure that was computed as the events first arrived

  @integration
  Scenario: A handler that dies does not leave a permanently wrong figure
    Given a derived figure being maintained as events arrive
    When the work maintaining it fails partway and is never retried
    And the figure is later rebuilt from the events
    Then it is correct
    And nothing about the earlier failure survives in it

  @integration
  Scenario: The same event delivered twice counts once
    Given an event that has already been accounted for
    When the platform is handed that same event again
    Then the derived figures are unchanged

  # ============================================================================
  # Work that must happen, happens
  # ============================================================================

  @integration
  Scenario: Work that costs money survives the worker that started it
    Given an event that must cause chargeable work
    When the process handling it dies before that work is dispatched
    Then the work is still dispatched afterwards

  @integration
  Scenario: Work is retried until it succeeds
    Given work that must happen in response to an event
    When the first attempt fails
    Then it is attempted again
    And it stops being attempted once it succeeds

  @integration
  Scenario: Work scheduled for later survives a restart
    Given work that should happen a set time after an event
    When every process is restarted before that time arrives
    Then the work still happens when it comes due

  # A handler often needs something derived from a DIFFERENT stream than the one
  # it is reacting to — an alert on an evaluation needs the trace that
  # evaluation names. The two streams settle independently, so "not there yet"
  # and "not there at all" look identical at the moment of the read, and the
  # difference matters: read as an answer, the alert is dropped for good,
  # because a terminal outcome arrives once and nothing asks again.
  @unit
  Scenario: Something the platform cannot read yet is not read as an answer
    Given work that needs a fact derived from another stream
    When that fact has not been derived yet at the moment the work runs
    Then the work is attempted again rather than treated as having nothing to do
    And it is not silently abandoned

  # ============================================================================
  # Handing work over is itself work that can fail
  # ============================================================================
  #
  # "Work is retried until it succeeds" above is about a handler that fails
  # while running. These are about the moment BEFORE that: handing the work to
  # the queue it will run on. The two are not the same act and did not have the
  # same guarantee.
  #
  # Retiring the reactor moved every post-event handler onto one fan-out seam.
  # The reactor's hand-off used to happen inside a queued job, so a blip failed
  # that job and the queue delivered it again. The seam has no job behind it —
  # it follows a write that is already committed and must not be undone — so
  # for one release a blip on the hand-off itself lost that handler's work for
  # that event outright, with nothing to re-run it.
  #
  # This is not a licence to retry forever. The write behind the seam has
  # already succeeded and the caller is waiting on it, so the attempts are
  # bounded and a queue that is genuinely down still ends in a reported loss —
  # just not a loss caused by a single unlucky packet.

  @unit
  Scenario: A blip handing work to its queue does not lose the work
    Given work that must happen in response to an event
    When the first attempt to hand it over fails and a later one succeeds
    Then the work is queued
    And it is counted as queued rather than as lost

  @unit
  Scenario: Handing the same work over twice leaves one piece of work
    Given a hand-off that fails after the queue has already accepted the work
    When the hand-off is attempted again
    Then the queue holds one piece of work for that event, not two

  @unit
  Scenario: A queue that stays unavailable gives up rather than holding up the write
    Given work that must happen in response to an event
    And a queue that fails every attempt
    When the event is published
    Then the attempts stop after a bounded number
    And an operator-visible count records the work as lost
    And the committed write behind it still stands

  @unit
  Scenario: Work whose hand-off cannot succeed is not retried
    Given work whose hand-off fails for a reason retrying cannot change
    When the event is published
    Then the hand-off is attempted once
    And the work is recorded as lost

  # The two failures look alike from the publisher's side on the substrate that
  # runs work as it is handed over, and they are not alike at all: re-handing
  # work over is free, re-running it is not, and running work again is already
  # covered above by the retry that follows the work itself.
  @unit
  Scenario: Work that fails while running is not mistaken for a failed hand-off
    Given work that fails while it runs rather than while it is handed over
    When the event is published
    Then the hand-off does not run it again
    And the failure is left to the retry that covers work as it runs

  # ============================================================================
  # Work that is allowed to be lost
  # ============================================================================
  #
  # Stated positively, because today it is an accident of queue configuration
  # rather than a decision. A live notification is worth nothing after the
  # person has gone, and redelivering it to a closed browser is a leak, not a
  # fix.

  @integration
  Scenario: A live update missed by a closed page is not redelivered
    Given someone was watching a page when an event arrived
    When they close the page before the update reaches them
    Then the update is not delivered later
    And nothing about it is kept

  @integration @unimplemented
  Scenario: A missed live update does not change what the page shows
    Given a live update was lost
    When the page is opened again
    Then it shows the same thing it would have shown had the update arrived

  # The constraint that there is no third kind of post-event work is an
  # architectural one, and it lives in ADR-075. It said nothing a customer
  # could observe, so asserting it here only restated the ADR in Gherkin.
