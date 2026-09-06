Feature: An evaluation run folds and executes deterministically

  A run must reach its terminal state exactly once no matter how many
  completions arrive for it, must skip rather than fail when its evaluator
  or preconditions do not hold, and must record an evaluator's own error as
  a result rather than lose the run.

  # evaluation-run.projection.ts, evaluation-analytics-fold.projection.ts,
  # evaluation-analytics-rollup.projection.ts, evaluation-analytics-row.projection.ts,
  # evaluation-execution-outcome.service.ts, evaluation-execution-intent.service.ts,
  # evaluation-execution-preparation.service.ts, evaluation-precondition.service.ts,
  # evaluator-availability.service.ts, evaluation-inputs-offload.service.ts

  @unit @unimplemented
  Scenario: An evaluation run reaches a terminal state exactly once
    Given a run that has already been marked finished
    When a further completion for it arrives
    Then the run's terminal state and finish time are unchanged

  @unit @unimplemented
  Scenario: A run whose evaluator is unavailable is marked skipped, not failed
    Given an evaluation whose evaluator is not available
    When the run is prepared
    Then the run is skipped with the reason recorded and no cost is charged

  @unit @unimplemented
  Scenario: An evaluation whose preconditions do not hold is not executed
    Given an evaluation whose precondition excludes the trace
    When the evaluation is considered
    Then it does not run and the trace is not billed for it

  @unit @unimplemented
  Scenario: Two completions for the same run fold to one analytics row
    Given a run reported complete twice
    When the analytics rollup is folded
    Then it holds one row for that run

  @unit @unimplemented
  Scenario: An evaluator error is recorded as an error result, not a lost run
    Given an evaluator that throws
    When the run executes
    Then the run finishes with an error result carrying the failure's code

  @unit
  Scenario: A completion folded after a start applies the run's completed state normally
    Given a run that has already been folded from its started event
    When its completed event is folded
    Then the run's status, score and pass state reflect the completion
