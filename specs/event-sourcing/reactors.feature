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
