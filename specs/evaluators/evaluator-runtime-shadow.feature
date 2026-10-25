Feature: Shadowing an evaluator on the Go runtime costs the customer nothing
  As a LangWatch operator comparing the Go evaluator runtime with langevals
  I want a shadow call that spends no provider key and takes no live capacity
  So that a customer never pays twice, waits longer or sees a different result

  # Plan: dev/docs/plans/langevals-go-replacement.md §4. Shadow is allowed only
  # for evaluators that make no model call: no model or embeddings setting and
  # no provider variables of their own (the evaluator catalogue's definition).
  # LLM evaluators move to Go on replay parity and the live-spread check instead.

  # ============================================================================
  # Defaults
  # ============================================================================

  @unit
  Scenario: With nothing set every evaluator runs on Python
    Given no evaluator runtime setting is written
    When the evaluation configuration is read
    Then the default engine is python and no evaluator has an override

  # ============================================================================
  # What may be shadowed
  # ============================================================================

  @unit
  Scenario: An evaluator that makes a model call cannot be put in shadow mode
    When an operator overrides "ragas/faithfulness" to shadow
    Then the configuration is refused, naming the evaluator and that it makes a model call

  @unit
  Scenario: A shadow default engine shadows only the evaluators that make no model call
    Given the default engine is shadow
    When "langevals/exact_match" and "ragas/faithfulness" are routed
    Then "langevals/exact_match" is shadowed
    And "ragas/faithfulness" runs on Python alone

  @unit
  Scenario: An override for an evaluator the catalogue does not know is refused
    When an operator overrides "langevals/not_a_real_one" to go
    Then the configuration is refused, naming the evaluator

  @unit
  Scenario: An override written with more than one engine is refused
    When an operator writes the override "langevals/exact_match=go=shadow"
    Then the configuration is refused, naming the entry

  # ============================================================================
  # The shadow call
  # ============================================================================

  @integration
  Scenario: A shadow call carries no provider credentials
    Given "langevals/exact_match" is in shadow mode
    When a project runs it with provider credentials in its environment
    Then the Python call carries those credentials
    And the Go call carries none

  @integration
  Scenario: A shadow call is marked so the runtime admits it outside the project's live share
    Given "langevals/exact_match" is in shadow mode
    When a project runs it
    Then the Go call is marked as a shadow call
    And a call routed to Go for real is not

  @integration
  Scenario: A failing shadow call changes nothing the customer sees
    Given "langevals/exact_match" is in shadow mode
    And the Python call fails once and is retried
    When the Go call is refused as unavailable, as busy, or cannot be reached
    Then the customer receives the Python result
    And the Python call was retried as without a shadow
    And the evaluation telemetry records only the Python outcome

  # ============================================================================
  # How the Go runtime admits a shadow call
  # ============================================================================

  @unit
  Scenario: A shadow call is refused at once when the shadow budget is full
    Given the Go runtime is running as many shadow calls as its shadow budget allows
    When another shadow call arrives
    Then it is refused as busy at once, carrying a retry delay
    And a live call is still answered without waiting

  @unit
  Scenario: Shadow calls never take a project's live share
    Given a project's shadow calls are in flight
    When the project's live calls fill its live share
    Then another shadow call for the project is still admitted

  # ============================================================================
  # Evaluators the Go runtime has not ported
  # ============================================================================

  @integration
  Scenario: A call the Go runtime does not serve is answered by langevals
    Given "langevals/valid_format" is routed to Go and langevals is deployed
    When the Go runtime answers that it does not serve the call, as for a format short of parity
    Then langevals answers the evaluation
    And nothing is logged at error level

  @integration
  Scenario: A built-in evaluator the Go runtime has not ported fails as a platform error
    Given "langevals/exact_match" is routed to Go and langevals is not deployed
    When the Go runtime answers that it does not know the evaluator
    Then the evaluation fails with an execution error, not a skip
    And the failure is logged at error level naming the evaluator

  @integration
  Scenario: An evaluator nobody knows stays not found when the Go runtime refuses it
    Given the default engine is go
    When a project runs an evaluator type the catalogue does not know
    And the Go runtime answers that it does not know the evaluator
    Then the evaluation fails with an "evaluator not found" error
