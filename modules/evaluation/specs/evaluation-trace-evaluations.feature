Feature: Evaluation reads a trace's earlier evaluations from its own runs

  @unit
  Scenario: A mapping that reads earlier evaluations gets evaluation's own runs for the trace
    Given an evaluator whose mapping reads the evaluations source
    When evaluation scores a trace
    Then it reads the latest version of each run on that trace from its own evaluation runs
    And it does not ask the trace module for them
    And each run reaches the mapping in the shape the trace's evaluations carry

  @unit
  Scenario: A mapping that reads no earlier evaluations does not read them
    Given an evaluator whose mapping does not read the evaluations source
    When evaluation scores a trace
    Then no earlier evaluations are read

  @unit
  Scenario: A batch of traces' earlier evaluations is read through the trace id index
    Given the evaluation runs trace id index is ready
    When evaluation reads the runs on several traces
    Then both the read and its latest-version subquery are bounded by the index's range
    And while the index is not ready the read carries no time bound

  @unit
  Scenario: A trace's earlier evaluations are still read when the inputs exceed the memory limit
    Given the read with inputs hits the ClickHouse memory limit
    When evaluation reads the runs on a trace
    Then it reads them again without the inputs
