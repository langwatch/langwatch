# Bindings target langwatch/src/server/experiments-v3/execution/__tests__/.
# The two scenarios still tagged @unimplemented need full orchestrator + nlpgo
# coverage (multi-row run continuation and cross-row trace linkage); they are
# proven by the end-to-end dogfood rather than the cell-level test.
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
    Then each dataset row produces one result from running the whole workflow
    And the run records three rows total

  @integration
  Scenario: The workflow's own evaluator nodes surface as evaluator results
    Given the workflow contains an evaluator node that scores the output
    When I run the workflow evaluation
    Then each row shows the score from that evaluator node
    And the score is reported as a number
    And the pass or fail verdict is reported as a boolean

  @integration @unimplemented
  Scenario: A row that fails does not abort the rest of the run
    Given the workflow raises an error on the second row
    When I run the workflow evaluation
    Then the second row is recorded with an error
    And the first and third rows still produce results

  @integration
  Scenario: Cost and duration from the workflow run are captured per row
    When I run the workflow evaluation
    Then each row records the cost and duration of the workflow run

  @integration @unimplemented
  Scenario: Each row gets a distinct trace id shared by its evaluator results
    When I run the workflow evaluation
    Then each row has its own trace id
    And that row's evaluator scores share the same trace id
