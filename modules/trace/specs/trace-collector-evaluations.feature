Feature: Trace records the evaluations a collector body carries as a fact
  A collector body may carry SDK evaluations beside its spans. Trace no longer reports them
  through EvaluationApi: it records one "evaluations received" fact per evaluation on its own
  trace_collector_evaluations pipeline, and evaluation reports each from its side
  (T1 D1, 2026-10-08; R38; ARCHITECTURE.md §9). The evaluator id a nameless one gets is
  evaluation-contract's pure rule (T1 D3).

  @unit
  Scenario: A collector evaluation is recorded as trace's evaluations-received fact
    Given a collector body carrying one evaluation for a trace
    When trace reports the evaluation
    Then it sends one record command on trace_collector_evaluations carrying the evaluation

  @unit
  Scenario: A collector evaluation with an unknown status is refused before it is recorded
    Given a collector evaluation whose status is not processed, error or skipped
    When trace reports the evaluation
    Then it is refused and nothing is recorded

  @unit
  Scenario: The fact lands on the trace's aggregate, once per evaluation and request
    When the record command is handled
    Then it emits one evaluations-received event on the trace's aggregate
    And its idempotency key names the trace, the evaluation and the request instant

  @unit
  Scenario: Collector evaluations refuse by name where no pipeline is bound
    Given trace in a process that bound no trace_collector_evaluations commands
    When trace reports a collector evaluation
    Then it refuses naming the trace_collector_evaluations commands
