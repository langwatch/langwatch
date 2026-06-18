# @unimplemented while this PR is in flight: each scenario gets its
# @scenario binding (and the @unimplemented tag is dropped) as the phase
# that implements it lands. Bindings target
# langwatch/src/server/experiments-v3/execution/__tests__/.
@unimplemented
Feature: A workflow runs as an evaluations-v3 target
  As an author evaluating a whole workflow
  I want the workflow to run through the same evaluations-v3 pipeline as prompts and agents
  So that workflow evaluation gets the parallelism, results page, and CI API of v3
  And we keep a single backend execution path instead of two.

  # The evaluations-v3 orchestrator runs one cell per dataset row. A "workflow"
  # target runs the full committed workflow once per row (the run-whole-workflow
  # primitive), instead of a single prompt/agent component.

  Background:
    Given a project with a committed workflow that has an entry node and an end node
    And the workflow has an attached dataset with three rows

  @integration
  Scenario: A workflow target produces one result per dataset row
    When I run an evaluation with the workflow as the target
    Then each dataset row produces one target result from the workflow end-node outputs
    And the run records three rows total

  @integration
  Scenario: The workflow's own evaluator nodes surface as evaluator results
    Given the workflow contains an evaluator node that scores the output
    When I run the workflow evaluation
    Then each row carries an evaluator result from that node
    And a string score from the workflow is coerced to a number
    And a string pass or fail from the workflow is coerced to a boolean

  @integration
  Scenario: A row that fails does not abort the rest of the run
    Given the workflow raises an error on the second row
    When I run the workflow evaluation
    Then the second row is recorded with an error
    And the first and third rows still produce results

  @integration
  Scenario: Cost and duration from the workflow run are captured per row
    When I run the workflow evaluation
    Then each target result records the workflow run cost and duration

  @integration
  Scenario: Each row gets a distinct trace id shared by its evaluator results
    When I run the workflow evaluation
    Then each row's target result has its own trace id
    And the evaluator results for that row reference the same trace id as the row's target
