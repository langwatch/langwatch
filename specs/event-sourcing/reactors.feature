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
    Given a reactor with a shouldReact predicate
    And an event the predicate evaluates as not relevant
    When the fold projection successfully applies and stores the event
    Then no job is enqueued for that reactor
    And the reactor's handler never runs for that event
    And a skipped outcome is recorded for observability

  Scenario: Relevant events are dispatched as before
    Given a reactor with a shouldReact predicate
    And an event the predicate evaluates as relevant
    When the fold projection successfully applies and stores the event
    Then the reactor is dispatched with the event and the fold state

  Scenario: A failing predicate never drops a side effect
    Given a reactor whose shouldReact predicate throws an error
    When the fold projection successfully applies and stores the event
    Then the error is logged
    And the reactor is dispatched anyway

  Scenario: Reactors without a predicate are unaffected
    Given a reactor with no shouldReact predicate
    When the fold projection successfully applies and stores the event
    Then the reactor is dispatched for every event
