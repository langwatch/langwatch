Feature: scenarioSetId defaults to "default" on ingestion

  When the SDK sends scenario events without a scenarioSetId, or with an
  empty string, the API must coerce the value to "default" so runs are
  visible and navigable in the UI. Events must never be rejected for
  missing or empty scenarioSetId — that loses data.

  # RELOCATED from langwatch/specs/scenarios/scenario-set-id-default.feature, a
  # directory outside the parity checker's scan roots, so every tag in it bound
  # nothing.
  #
  # One scenario was dropped in the move: "runtime fallback in ClickHouse
  # dispatch", which asserted a second coercion at the dispatch boundary. There
  # is no such site any more — `event-schemas.ts` coerces once, at the schema
  # edge, and every consumer downstream receives the already-coerced value.
  # Keeping it would have described a fallback that cannot fail because it does
  # not exist.

  Background:
    Given a project with event-sourcing enabled

  @unit
  Scenario: scenarioSetId omitted from event
    When the SDK sends a RUN_STARTED event without a scenarioSetId field
    Then the event is accepted
    And scenarioSetId is set to "default"

  @unit @regression
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
  Scenario: MESSAGE_SNAPSHOT event omits scenarioSetId
    When the SDK sends a MESSAGE_SNAPSHOT event without a scenarioSetId field
    Then scenarioSetId is set to "default"
