# Supersedes reactors.feature. See dev/docs/adr/095-post-event-work-subscribers-and-process-managers.md:
# post-event work is subscribers (best-effort) and process managers
# (stake-sensitive); the reactor vocabulary is retired. The shouldReact
# contract from ADR-026 carries over as the subscriber `when` guard.
Feature: Post-event work

  After an event is committed and a projection has applied it, follow-on work
  runs through one of two primitives. A subscriber is best-effort: it fires
  after the projection commits, may be debounced, deduplicated or throttled,
  retries only once its job is queued, and never runs during replay. A
  process manager is stake-sensitive: it consumes each event exactly once,
  keeps durable state, and dispatches its work through an outbox that
  retries. Everything a subscriber does must be safe to lose once; anything
  that is not belongs to a process manager.

  Background:
    Given a fold projection "traceSummary"
    And a subscriber "evaluationTrigger" registered on "traceSummary"

  @unit
  Scenario: A subscriber fires only after its projection commits
    Given an event for aggregate "trace-123"
    When the "traceSummary" fold projection successfully applies and stores the event
    Then the "evaluationTrigger" subscriber is dispatched asynchronously
    And the subscriber receives both the event and the latest fold state

  @unit
  Scenario: A projection failure prevents the side effect
    Given an event for aggregate "trace-456"
    When the "traceSummary" fold projection fails to store the state
    Then the "evaluationTrigger" subscriber is NOT dispatched
    And side effects are prevented until the fold succeeds on retry

  @unit
  Scenario: An irrelevant event is rejected before any job is queued
    Given a subscriber that declares which events are relevant to it
    And an event the subscriber considers not relevant
    When the fold projection successfully applies and stores the event
    Then no job is enqueued for that subscriber
    And the subscriber's handler never runs for that event

  @unit
  Scenario: A failing relevance guard never drops a side effect
    Given a subscriber whose relevance guard throws an error
    When the fold projection successfully applies and stores the event
    Then the error is logged
    And the subscriber is dispatched anyway

  @unit
  Scenario: A subscriber without a relevance guard fires for every event
    Given a subscriber that does not declare a relevance guard
    When the fold projection successfully applies and stores the event
    Then the subscriber is dispatched for every event

  # Only config presence is asserted today; the runtime gating has no test.
  @unimplemented
  Scenario: A subscriber restricted to a process role stays inert elsewhere
    Given a subscriber configured to run only in the worker role
    And the current process role is "web"
    When a fold projection succeeds
    Then the subscriber is not initialized or executed in this process

  @unit
  Scenario: A throttled subscriber fires at most once per window
    Given a subscriber throttled to one firing per window
    When events for the same aggregate arrive continuously
    Then the subscriber fires once per window with the newest payload
    And the window deadline is pinned to the event that opened it

  @unit
  Scenario: A registration keeps its queue identity across the vocabulary change
    Given a side effect that was registered as a reactor before this decision
    When it is registered as a subscriber under the same name
    Then jobs staged under the old registration dispatch into the new one

  # Evaluation dispatch keeps its guard contract through the conversion.
  @unit
  Scenario: The origin guard filters a non-message event before enqueue
    Given a topic-assigned event on a trace with a resolved origin
    Then the origin-guarded subscriber declines to react

  @unit
  Scenario: The origin guard filters a trace with no resolved origin before enqueue
    Given a span event on a trace whose origin is unresolved
    Then the origin-guarded subscriber declines to react

  @unit
  Scenario: The origin guard admits a genuine message event before enqueue
    Given a recent span event on a recent trace with a resolved origin
    Then the origin-guarded subscriber agrees to react

  @unit
  Scenario: The evaluation trigger dispatches nothing past the span processing cap
    Given a span event on a trace whose span count has passed the span processing cap
    When the evaluation trigger runs
    Then no evaluation is dispatched

  @unit
  Scenario: The evaluation trigger declines a synthetic span before enqueue
    Given a synthetic span event on a trace with a resolved origin
    Then the evaluation trigger declines to react

  # Replay rebuilds projections only. No subscriber may observe a replayed
  # event: side effects are not rebuildable from the event log by design,
  # and anything that must be belongs to a projection or process manager.
  @unimplemented
  Scenario: Replay never re-runs side effects
    Given a completed trace whose events are replayed
    When the replay applies the events to the projections
    Then no subscriber fires for any replayed event
