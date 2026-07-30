Feature: Global projections see every pipeline's events

  Most projections belong to one pipeline and only ever see that pipeline's
  events. A global projection is registered once and receives events from all
  of them, which is what makes a cross-pipeline number — a per-project daily
  count of billable events, say — expressible at all.

  # The mechanism is the global projection registry: after a pipeline commits
  # its events locally, the same events are also dispatched to that registry,
  # which processes them on a dedicated virtual pipeline named "global".
  #
  # This file replaces an earlier version titled "Global Projections and
  # Reactors". The global reactor it described (`billingMeterDispatch`) was
  # deleted with the reactor concept itself (ADR-075) — post-event work is now
  # an event subscriber, a projection or a process manager, and a global
  # handler that needs to DISPATCH work belongs on a pipeline that owns the
  # work, not in the global registry. The earlier file was also untagged, so it
  # enforced nothing while reading as green.
  #
  # Nothing registers a global projection today. The registry and its dispatch
  # are live wiring with no current occupant, so the scenarios below are the
  # contract the next one inherits rather than a description of production
  # traffic. They are parked @unimplemented for that reason: no test exercises
  # the global dispatch path, and pretending otherwise is how the previous
  # version of this file came to assert a component that no longer existed.

  @unimplemented
  Scenario: an event committed on any pipeline also reaches the global registry
    Given a global projection is registered
    When an event is committed on the trace-processing pipeline
    Then the event is applied to that pipeline's own projections
    And the same event is dispatched to the global projection registry
    And the global projection sees it

  @unimplemented
  Scenario: global work runs on its own virtual pipeline
    Given a global projection is registered
    When events from several pipelines are dispatched to it
    Then they are processed on the virtual pipeline named "global"
    And they are not processed on the pipeline that committed them

  @unimplemented
  Scenario: a failing global projection does not fail the pipeline that fed it
    Given a global projection that throws when it is applied
    When an event is committed on the trace-processing pipeline
    Then the commit still succeeds
    And that pipeline's own projections still apply the event
    And the global failure is reported rather than swallowed
