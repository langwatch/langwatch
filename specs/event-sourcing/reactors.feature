# See dev/docs/adr/026-reactor-should-react-predicate.md for the
# shouldReact predicate rationale.
Feature: Reactors

  Reactors are post-fold side-effect handlers. they allow reacting to the
  fully computed and persisted state of an aggregate.

  Background:
    Given a fold projection "traceSummary"
    And a reactor "evaluationTrigger" registered on "traceSummary"

  Scenario: Execution after successful fold
    Given an event for aggregate "trace-123"
    When the "traceSummary" fold projection successfully applies and stores the event
    Then the "evaluationTrigger" reactor is dispatched asynchronously
    And the reactor receives both the event and the latest fold state

  Scenario: Prevention on fold failure
    Given an event for aggregate "trace-456"
    When the "traceSummary" fold projection fails to store the state
    Then the "evaluationTrigger" reactor is NOT dispatched
    And side effects are prevented until the fold succeeds on retry

  Scenario: Selective execution by role
    Given a reactor configured with runIn: ["worker"]
    And the current process role is "web"
    When a fold projection succeeds
    Then the reactor is NOT initialized or executed in this process

  Scenario: Irrelevant events are filtered before enqueue
    Given a reactor that declares which events are relevant to it
    And an event the reactor considers not relevant
    When the fold projection successfully applies and stores the event
    Then no job is enqueued for that reactor
    And the reactor's handler never runs for that event
    And a skipped outcome is recorded for observability

  Scenario: Relevant events are dispatched as before
    Given a reactor that declares which events are relevant to it
    And an event the reactor considers relevant
    When the fold projection successfully applies and stores the event
    Then the reactor is dispatched with the event and the fold state

  Scenario: A failing relevance check never drops a side effect
    Given a reactor whose relevance check throws an error
    When the fold projection successfully applies and stores the event
    Then the error is logged
    And the reactor is dispatched anyway

  Scenario: Reactors without a relevance check are unaffected
    Given a reactor that does not declare a relevance check
    When the fold projection successfully applies and stores the event
    Then the reactor is dispatched for every event

  # The evaluation trigger's `shouldReact` predicate is a relevance check
  # (guards enqueue, not the handler) evaluated before the event is
  # dispatched — the same "guards run before enqueue" contract as above.
  Scenario: The origin guard filters a non-message event before enqueue
    Given a topic-assigned event on a trace with a resolved origin
    Then the origin-guarded reactor declines to react

  Scenario: The origin guard filters a trace with no resolved origin before enqueue
    Given a span event on a trace whose origin is unresolved
    Then the origin-guarded reactor declines to react

  Scenario: The origin guard admits a genuine message event before enqueue
    Given a recent span event on a recent trace with a resolved origin
    Then the origin-guarded reactor agrees to react

  Scenario: The evaluation trigger dispatches nothing past the span processing cap
    Given a span event on a trace whose span count has passed the span processing cap
    When the evaluation trigger runs
    Then no evaluation is dispatched

  Scenario: The evaluation trigger declines a synthetic span before enqueue
    Given a synthetic span event on a trace with a resolved origin
    Then the evaluation trigger declines to react
