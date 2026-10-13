Feature: An evaluation's inputs are read on the evaluations namespace
  The trace drawer's evaluation card expands what an evaluation was run over. Evaluation owns
  the inputs, offloaded ones included, so it serves the read; the door moved here from
  traces.getEvaluationInputs with its owner (CD-2; T1 D2, 2026-10-08), keeping its input,
  output and its `traces:view` gate.

  @unit
  Scenario: An evaluation card reads the evaluation's inputs from evaluations
    Given an evaluation in a project whose inputs evaluation stored
    When the trace drawer asks evaluations for that evaluation's inputs
    Then it is answered with the inputs evaluation resolves for the project's tenant

  @unit
  Scenario: An evaluation with no stored inputs answers none
    Given an evaluation in a project with no stored inputs
    When the trace drawer asks evaluations for that evaluation's inputs
    Then it is answered with no inputs
