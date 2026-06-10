Feature: If/Else conditional branch node in workflows
  As a user building evaluation workflows
  I want an if/else node that routes execution down a true or false branch
  So that conditional evaluators (e.g. faithfulness only when a tool was triggered)
  run only when their precondition holds, without code-block workarounds

  # Customer context: evaluators like faithfulness only make sense when a
  # tool call produced a context. Today the only workaround is a code
  # block calling langwatch.evaluations.evaluate() behind a hand-written
  # if. The if/else node makes the branch first-class: the condition is
  # evaluated by the engine, the not-taken branch is skipped entirely
  # (no cost, no latency), and skipped nodes are visibly skipped.

  Background:
    Given I am logged in
    And I have a workflow open in the optimization studio

  # ============================================================================
  # Authoring: palette, node shape, condition editing
  # ============================================================================

  @integration @unimplemented
  Scenario: If/Else is available in the node palette
    When I open the node palette
    Then I see an "If/Else" block listed alongside Code and HTTP blocks
    And dragging it onto the canvas creates an if/else node

  @integration @unimplemented
  Scenario: If/Else node has one condition and two output branches
    Given an if/else node on the canvas
    Then the node shows input handles for its declared inputs
    And the node shows a "true" output handle and a "false" output handle
    And connected downstream edges are visually tied to their branch

  @integration @unimplemented
  Scenario: Editing the condition expression in the properties panel
    Given an if/else node with input "context"
    When I open the node's properties panel
    And I set the condition to "context != ''"
    Then the condition is saved on the node's parameters
    And the workflow autosaves with the new condition

  # ============================================================================
  # Execution: routing + skipping (engine behavior)
  # ============================================================================

  @integration @unimplemented
  Scenario: True condition executes only the true branch
    Given an if/else node whose condition evaluates to true for the input
    And a "Faithfulness" evaluator connected to the "true" branch
    And a code node connected to the "false" branch
    When the workflow executes
    Then the evaluator on the true branch runs
    And the code node on the false branch is skipped
    And the skipped node reports status "skipped" with zero cost

  @integration @unimplemented
  Scenario: False condition executes only the false branch
    Given an if/else node whose condition evaluates to false for the input
    And a "Faithfulness" evaluator connected to the "true" branch
    And a code node connected to the "false" branch
    When the workflow executes
    Then the evaluator on the true branch is skipped
    And the code node on the false branch runs

  @integration @unimplemented
  Scenario: Skipping cascades to downstream-only nodes of the skipped branch
    Given a chain of two nodes connected after the "false" branch
    And the condition evaluates to true
    When the workflow executes
    Then both nodes of the false-branch chain are skipped
    And nodes reachable from the true branch all execute

  @integration @unimplemented
  Scenario: A node fed by both branches runs when either branch is taken
    Given an end node receiving inputs from both the true and false branches
    When the workflow executes with the condition evaluating to true
    Then the end node executes using the outputs of the true branch

  @integration @unimplemented
  Scenario: Condition errors fail the if/else node, not the whole engine
    Given an if/else node whose condition references a missing field
    When the workflow executes
    Then the if/else node reports an error state with a clear message
    And downstream nodes of both branches are skipped

  # ============================================================================
  # Studio feedback
  # ============================================================================

  @unimplemented
  Scenario: Skipped nodes are visually distinguished after a run
    Given a workflow run where the false branch was skipped
    Then skipped nodes render with a muted "skipped" status indicator
    And the taken branch shows normal success states
