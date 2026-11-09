Feature: Evaluator records that an evaluator was created
  Creating an evaluator is evaluator's own fact, recorded on its evaluator_lifecycle
  pipeline after the row is written, with ids only. Peers count or react from their own
  side and read anything else through EvaluatorApi (ARCHITECTURE.md §9). Nurturing does
  not read it yet.

  @unit
  Scenario: creating an evaluator records that it was created
    Given evaluator_lifecycle is registered in the process
    When an evaluator is created
    Then evaluator sends one evaluator created fact carrying only ids, keyed to the project

  @unit
  Scenario: copying an evaluator into another project records the copy as created
    Given evaluator_lifecycle is registered in the process
    When an evaluator is copied into another project
    Then evaluator sends one evaluator created fact for the copy, keyed to the target project

  @unit
  Scenario: publishing a workflow as an evaluator records the new evaluator as created
    Given a workflow with no evaluator yet
    When the workflow is saved as an evaluator
    Then evaluator sends one evaluator created fact for the evaluator that wraps it

  @unit
  Scenario: renaming an already published workflow records nothing new
    Given a workflow that already has an evaluator
    When the workflow is saved as an evaluator again
    Then no evaluator created fact is sent

  @unit
  Scenario: a redelivered evaluator created command records nothing new
    Given an evaluator created command
    When the command is handled twice
    Then both events carry one idempotency key

  @unit
  Scenario: a lost created fact never fails the create
    Given evaluator_lifecycle is not registered in the process, or its record fails
    When an evaluator is created
    Then the evaluator is created and nothing is thrown
    And one error is logged naming the tenant, project and evaluator ids
