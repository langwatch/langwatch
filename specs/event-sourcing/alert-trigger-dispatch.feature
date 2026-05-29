Feature: Alert trigger dispatch

  Two reactors evaluate user-defined alert triggers and dispatch their
  configured action: the trace-pipeline reactor handles triggers whose
  filters are trace-only, and the evaluation-pipeline reactor handles
  triggers that also filter on evaluation results. Both can fire for the
  same trigger and trace, so they share a match-claim that guarantees a
  trigger dispatches at most once per trace.

  This describes the in-line dispatch path. Now that dispatch endpoints
  raise a DispatchError on failure (see dispatch-error-contract.feature),
  a failed dispatch must surface rather than masquerade as success.

  Scenario: A matching trace-only trigger is claimed then dispatched
    Given an active trigger whose trace-only filters match an incoming trace
    When the trace-pipeline reactor evaluates it
    Then it claims the match for this trigger and trace
    And it dispatches the trigger's action
    And it records the trigger as having run

  Scenario: A matching evaluation trigger fires on the evaluation pipeline
    Given an active trigger with evaluation filters that match a completed evaluation
    When the evaluation-pipeline reactor evaluates it
    Then it claims the match for this trigger and trace
    And it dispatches the trigger's action

  Scenario: A trigger dispatches at most once across racing pipelines
    Given the trace and evaluation pipelines both match the same trigger and trace
    When both reactors attempt to claim the match
    Then exactly one claim succeeds
    And the trigger's action dispatches a single time

  Scenario: A trigger already sent for this trace is skipped
    Given a trigger whose match was already claimed for this trace
    When a reactor evaluates it again
    Then the claim fails
    And no action is dispatched
    And the trigger is not recorded as having run again

  # Failure handling — the Phase 1 change

  Scenario: A failed dispatch is surfaced, not swallowed
    Given a matching trigger whose dispatch raises a DispatchError
    When a reactor dispatches it
    Then the failure is logged and captured for operators
    And the failure's retryable classification is included
    And the trigger is not recorded as having run

  Scenario: One trigger's failure does not block the others
    Given several matching triggers where one dispatch raises a DispatchError
    When a reactor processes the batch
    Then the remaining triggers are still evaluated and dispatched
