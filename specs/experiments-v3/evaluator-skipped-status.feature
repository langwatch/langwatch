Feature: A skipped evaluation shows as skipped in the workbench
  As someone reading evaluation results in the experiments workbench
  I want an evaluator that declined to evaluate a row to say so
  So that I can tell a row that was not evaluated from a row that was

  # An evaluator answers with one of three statuses: processed, skipped or
  # error. Skipped is how it declines a row it cannot judge, for example an
  # entry over its max tokens or a Ragas entry with no contexts, and the
  # reason travels in the details. The workbench mapper that turns the
  # engine's node result into an evaluator result only knew error, so a
  # skipped verdict was reported as processed with the reason under it. A
  # customer read "Status: Processed" over "Total tokens exceed the maximum"
  # and had to work out that the row had not been evaluated at all.
  #
  # Bindings:
  #   platform/app/src/server/experiments-v3/execution/resultMapper.ts
  #   platform/app/src/server/experiments-v3/execution/orchestrator.ts
  #   platform/app/src/server/experiments-v3/execution/__tests__/resultMapper.test.ts
  #   platform/app/src/server/experiments-v3/execution/__tests__/orchestratorStorageDispatch.unit.test.ts

  @unit
  Scenario: A skipped verdict from a component evaluator is reported as skipped
    Given an evaluator node that answered with status skipped and a reason
    When the node result is mapped to an evaluator result
    Then the evaluator result has status skipped
    And it carries the reason
    And it carries no score and no pass verdict

  @unit
  Scenario: A skipped verdict from a workflow evaluator is reported as skipped
    Given a workflow evaluator node that answered with status skipped and a reason
    When the node result is mapped to an evaluator result
    Then the evaluator result has status skipped
    And it carries the reason

  @unit
  Scenario: The stored row keeps the reason a row was skipped
    Given an evaluator result with status skipped and a reason
    When the result is recorded for the run
    Then the stored row has status skipped
    And the stored row carries the reason
