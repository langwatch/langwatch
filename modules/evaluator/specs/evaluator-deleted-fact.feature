Feature: Evaluator records that an evaluator was deleted
  Archiving an evaluator with its cascade is evaluator's own fact, recorded on its
  evaluator_lifecycle pipeline. Monitor removes the monitors that ran it from its own
  side, after a lag; evaluator holds no monitor dependency (ARCHITECTURE.md §9, R7).

  @unit
  Scenario: a cascade archive records that the evaluator was deleted
    Given evaluator_lifecycle is registered in the process
    When an evaluator with a linked workflow is cascade archived
    Then the evaluator and its workflow are archived
    And evaluator sends one evaluator deleted fact carrying only ids, keyed to the project

  @unit
  Scenario: a redelivered evaluator deleted command records nothing new
    Given an evaluator deleted command
    When the command is handled twice
    Then both events carry one idempotency key

  @unit
  Scenario: an evaluator deletion outside a registered pipeline is refused by name
    Given evaluator_lifecycle is not registered in the process
    When an evaluator is cascade archived
    Then the record fails naming evaluator_lifecycle

  @unit
  Scenario: the archive confirmation names only the linked workflow
    Given an evaluator with a linked workflow
    When the archive confirmation asks what goes with it
    Then evaluator answers the workflow, and the monitors are read from monitor
