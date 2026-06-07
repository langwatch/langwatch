@regression
Feature: Workflow evaluator output envelope preservation
  As an experiment author running an evaluator in a Studio workflow
  I want the evaluation reasoning (details) to reach the result panel
  So that I can see WHY an evaluator passed or failed, not just the verdict

  # An evaluator node returns the EvaluationResultWithMetadata envelope:
  # status, score, passed, label, details (the reasoning) and cost. The
  # node's declared `outputs` only enumerate the VALUE fields a downstream
  # node might wire (typically passed / score / label) — they never list
  # the metadata envelope. The legacy Python executor surfaced the full
  # result dict regardless (end_component_event did outputs = dict(result)),
  # so the reasoning always reached the result panel + batch reporter.
  #
  # The Go nlpgo executor filtered the evaluator output down to the
  # declared names, which silently dropped `details` (and status/cost)
  # whenever a node declared only [passed, score, label] — erasing the
  # reasoning from the workbench result popover and the batch eval report.
  # This restores parity: value outputs stay author-controlled, the
  # metadata envelope is always surfaced.

  Scenario: Reasoning survives when the evaluator node declares only value outputs
    Given a Studio workflow with an evaluator node
    And the evaluator node declares its outputs as only "passed", "score" and "label"
    And the evaluator returns a non-empty "details" reasoning string
    When the workflow executor runs the evaluator node
    Then the evaluator node output still carries the "details" reasoning
    And it still carries the "status" envelope field
    And it carries the declared "passed", "score" and "label" value fields

  Scenario: Undeclared value outputs are filtered while the envelope is kept
    Given a Studio workflow with an evaluator node
    And the evaluator node declares its outputs as only "passed"
    And the evaluator returns score, label and a non-empty "details" reasoning string
    When the workflow executor runs the evaluator node
    Then the evaluator node output carries the declared "passed" value field
    And the undeclared "score" and "label" value fields are filtered out
    And the "details" reasoning and "status" envelope fields are still present
