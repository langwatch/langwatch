Feature: Work that happens after an event
  As someone whose data the platform derives things from
  I want everything derived from my events to be reproducible from those events
  So that a bad day for a worker is not a permanent wrong number on my bill,
  my audit trail, or my dashboard

  # See dev/docs/adr/075-post-event-work-subscribers-and-process-managers.md
  #
  # Supersedes specs/event-sourcing/reactors.feature, which specified the
  # reactor — a third kind of post-event handler that ADR-075 retires. The
  # scenarios there described a mechanism; the ones here describe what a
  # customer is entitled to rely on regardless of mechanism.
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
  # These scenarios are @unimplemented: they describe the contract ADR-075
  # adopts, not what ships today. Today seventeen reactors still exist and
  # replay does not run them.

  # ============================================================================
  # Derived facts are reproducible
  # ============================================================================

  @integration @unimplemented
  Scenario: A number someone reads as fact can be rebuilt from the events
    Given events that a derived figure is computed from
    When the figure is recomputed from those same events
    Then it matches the figure that was computed as the events first arrived

  @integration @unimplemented
  Scenario: A handler that dies does not leave a permanently wrong figure
    Given a derived figure being maintained as events arrive
    When the work maintaining it fails partway and is never retried
    And the figure is later rebuilt from the events
    Then it is correct
    And nothing about the earlier failure survives in it

  @integration @unimplemented
  Scenario: The same event delivered twice counts once
    Given an event that has already been accounted for
    When the platform is handed that same event again
    Then the derived figures are unchanged

  # ============================================================================
  # Work that must happen, happens
  # ============================================================================

  @integration @unimplemented
  Scenario: Work that costs money survives the worker that started it
    Given an event that must cause chargeable work
    When the process handling it dies before that work is dispatched
    Then the work is still dispatched afterwards

  @integration @unimplemented
  Scenario: Work is retried until it succeeds
    Given work that must happen in response to an event
    When the first attempt fails
    Then it is attempted again
    And it stops being attempted once it succeeds

  @integration @unimplemented
  Scenario: Work scheduled for later survives a restart
    Given work that should happen a set time after an event
    When every process is restarted before that time arrives
    Then the work still happens when it comes due

  # ============================================================================
  # Work that is allowed to be lost
  # ============================================================================
  #
  # Stated positively, because today it is an accident of queue configuration
  # rather than a decision. A live notification is worth nothing after the
  # person has gone, and redelivering it to a closed browser is a leak, not a
  # fix.

  @integration @unimplemented
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
