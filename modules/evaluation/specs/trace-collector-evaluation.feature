Feature: Evaluation reports the evaluations trace received from a collector body
  Trace records each evaluation a collector body carried as its "evaluations received" fact;
  evaluation peer-subscribes and reports it on its own reportEvaluation command, as the
  collector's call through EvaluationApi used to (T1 D1, 2026-10-08; R38; §9).

  @unit
  Scenario: Evaluation reports each evaluation trace received from a collector body
    Given trace recorded an evaluation a collector body carried
    When evaluation hears the fact
    Then it reports that evaluation on its own reportEvaluation command, in the fact's tenant

  @integration
  Scenario: The worker hosts trace's collector evaluation pipeline and evaluation's lane on it
    Given the worker booted over its installed modules
    Then it hosts the trace_collector_evaluations pipeline
    And evaluation_processing carries the traceCollectorEvaluation lane
