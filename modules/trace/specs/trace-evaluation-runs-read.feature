Feature: Trace reads evaluation runs through its own repository
  Evaluation owns evaluation_runs and shares it with trace for reading (R40, EF-5).
  Trace's evaluation joins read the shared table themselves rather than asking
  EvaluationApi, each read answering what evaluation's own read answered: the
  latest version of every evaluation, inside the tenant.
  (peer-cycles plan 2026-10-08 T1: cut trace -> evaluation, PC-3)

  @unit
  Scenario: A trace's evaluation runs are the latest version of each run from the last seven days
    Given evaluation has recorded runs against a trace
    When trace reads the runs recorded against that trace
    Then it reads evaluation_runs inside the tenant over the last seven days, latest version of each run
    And each row arrives as an evaluation run

  @unit
  Scenario: The trace list's evaluation summaries are read per trace since the window opened
    Given evaluation has recorded runs against the traces on one list page
    When trace reads the page's evaluation summaries
    Then it reads evaluation_runs inside the tenant scheduled since the window opened, latest version of each run
    And the summaries are grouped by trace

  @unit
  Scenario: A trace's evaluations retry without their inputs when ClickHouse runs out of memory
    Given reading a trace's evaluations with their inputs exceeds ClickHouse's memory limit
    When trace reads the evaluations of that trace
    Then it reads them again without inputs
    And every asked trace answers, an unevaluated one with no evaluations

  @unit
  Scenario: Trace asks nothing of evaluation_runs for an empty list of traces
    When trace reads evaluation summaries or evaluations for no traces
    Then it answers empty without querying ClickHouse
