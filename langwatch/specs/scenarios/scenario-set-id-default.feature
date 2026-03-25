Feature: scenarioSetId defaults to "default" on ingestion

  When the SDK sends scenario events without a scenarioSetId, or with an
  empty string, the API must coerce the value to "default" so runs are
  visible and navigable in the UI. Events must never be rejected for
  missing or empty scenarioSetId — that loses data.

  Background:
    Given a project with event-sourcing enabled

  @unit
  Scenario: scenarioSetId omitted from event
    When the SDK sends a RUN_STARTED event without a scenarioSetId field
    Then the event is accepted
    And scenarioSetId is set to "default"

  @unit
  Scenario: scenarioSetId is empty string
    When the SDK sends a RUN_STARTED event with scenarioSetId ""
    Then the event is accepted
    And scenarioSetId is coerced to "default"

  @unit
  Scenario: scenarioSetId is a valid string
    When the SDK sends a RUN_STARTED event with scenarioSetId "my-set"
    Then the event is accepted
    And scenarioSetId is "my-set"

  @unit
  Scenario: all event types inherit the default
    When the SDK sends a MESSAGE_SNAPSHOT event without a scenarioSetId field
    Then scenarioSetId is set to "default"

  @unit
  Scenario: runtime fallback in ClickHouse dispatch
    When the API dispatches a RUN_STARTED event to ClickHouse
    And the event has scenarioSetId ""
    Then the ClickHouse command receives scenarioSetId "default"
