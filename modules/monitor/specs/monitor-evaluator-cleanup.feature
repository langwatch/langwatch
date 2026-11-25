Feature: Monitor removes the monitors of a deleted evaluator
  Evaluator records that an evaluator was deleted as its own fact. Monitor reacts from
  its own side and removes the monitors that ran it, after a lag; evaluator holds no
  monitor dependency (ARCHITECTURE.md §9, R7).

  @unit
  Scenario: a deleted evaluator's monitors are removed
    Given the monitor_evaluator_cleanup pipeline over a project with two monitors on one evaluator
    When evaluator records that evaluator as deleted
    Then monitor removes both monitors that ran it
    And the monitors on other evaluators stay

  @unit
  Scenario: a redelivered evaluator deleted fact is harmless
    Given the monitor_evaluator_cleanup pipeline
    When the same evaluator deleted fact is delivered twice
    Then both deliveries share one deduplication identity
    And the second delivery removes nothing and does not fail
