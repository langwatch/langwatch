Feature: A workflow used as an evaluator can decline a row
  As someone reading evaluation results from a monitor
  I want a workflow evaluator that declined a row to be recorded as skipped
  So that a row nothing judged is not stored as a completed evaluation

  # A workflow can be wired up as an evaluator. When it runs, the run either
  # succeeds or it does not, and that outer result is what the two call sites
  # below used to key off: anything that succeeded was written down as
  # "processed". But a successful run is not the same as a verdict — the
  # workflow can succeed at telling us it declined the row, and that answer
  # arrives in the result's own `status`. Overwriting it stored a completed
  # evaluation carrying a reason and no score.
  #
  # Only "skipped" is honoured. An "error" verdict is expected to carry
  # error_type and a traceback that neither path can supply, so any status
  # that is not recognised keeps the old "processed".
  #
  # specs/experiments-v3/evaluator-skipped-status.feature is the same bug on
  # the workbench path; these two call sites were not covered by that fix.
  #
  # Only the app-layer service is exercised below: it takes an injected
  # workflow executor, so the run can be faked. `customEvaluation` in
  # runEvaluation.ts is a module-private const with no seam, and carries the
  # same allowlist by inspection.
  #
  # Bindings:
  #   platform/app/src/server/app-layer/evaluations/evaluation-execution.service.ts
  #   platform/app/src/server/evaluations/runEvaluation.ts
  #   platform/app/src/server/app-layer/evaluations/__tests__/evaluation-execution.service.unit.test.ts

  @unit
  Scenario: A workflow that declined the row is recorded as skipped
    Given a workflow evaluator whose run succeeded
    And the result it returned has status skipped and a reason
    When the evaluation is recorded
    Then the evaluation has status skipped
    And it carries the reason the workflow gave

  @unit
  Scenario: A status this path cannot support falls back to processed
    Given a workflow evaluator whose run succeeded
    And the result it returned has a status other than skipped
    When the evaluation is recorded
    Then the evaluation has status processed
