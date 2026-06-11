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

  @integration
  Scenario: If/Else is available in the node palette
    When I open the node palette
    Then I see an "If/Else" block listed alongside Code and HTTP blocks
    And dragging it onto the canvas creates an if/else node

  @integration
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

  @integration
  Scenario: True condition executes only the true branch
    Given an if/else node whose condition evaluates to true for the input
    And a "Faithfulness" evaluator connected to the "true" branch
    And a code node connected to the "false" branch
    When the workflow executes
    Then the evaluator on the true branch runs
    And the code node on the false branch is skipped
    And the skipped node reports status "skipped" with zero cost

  @integration
  Scenario: False condition executes only the false branch
    Given an if/else node whose condition evaluates to false for the input
    And a "Faithfulness" evaluator connected to the "true" branch
    And a code node connected to the "false" branch
    When the workflow executes
    Then the evaluator on the true branch is skipped
    And the code node on the false branch runs

  @integration
  Scenario: Skipping cascades to downstream-only nodes of the skipped branch
    Given a chain of two nodes connected after the "false" branch
    And the condition evaluates to true
    When the workflow executes
    Then both nodes of the false-branch chain are skipped
    And nodes reachable from the true branch all execute

  @integration
  Scenario: A node fed by both branches runs when either branch is taken
    Given an end node receiving inputs from both the true and false branches
    When the workflow executes with the condition evaluating to true
    Then the end node executes using the outputs of the true branch

  @integration
  Scenario: Condition errors fail the if/else node, not the whole engine
    Given an if/else node whose condition references a missing field
    When the workflow executes
    Then the if/else node reports an error state naming the missing field
    And no downstream node executes

  # ============================================================================
  # Studio feedback
  # ============================================================================

  @unimplemented
  Scenario: Skipped nodes are visually distinguished after a run
    Given a workflow run where the false branch was skipped
    Then skipped nodes render with a muted "skipped" status indicator
    And the taken branch shows normal success states

  # ============================================================================
  # Condition authoring (liquid editor + python code mode)
  # ============================================================================

  @integration
  Scenario: The condition help links to the Liquid documentation
    Given an if/else node drawer is open
    Then the condition help text is a single short line
    And it links to the Liquid operators documentation

  @integration
  Scenario: Toggling Code seeds a python template from the inputs
    Given an if/else node with input "context"
    When I enable the Code toggle
    Then the condition language becomes python
    And the code parameter is seeded with an execute function taking "context"
    And the template returns a boolean

  @integration
  Scenario: Code mode renders the python editor instead of the expression input
    Given an if/else node with condition language python
    When I open the drawer
    Then I see the python code editor
    And no liquid expression input

  @integration
  Scenario: Toggling Code off returns to the liquid expression
    Given an if/else node in code mode
    When I disable the Code toggle
    Then the condition language becomes liquid
    And the stored python code is kept

  @integration
  Scenario: A python condition routes the true branch
    Given an if/else gate with condition language python
    And code that returns True when the context is non-empty
    When the workflow runs with a non-empty context
    Then only the true branch executes

  @integration
  Scenario: A python condition routes the false branch
    Given an if/else gate with condition language python
    And code that returns True when the context is non-empty
    When the workflow runs with an empty context
    Then only the false branch executes

  @integration
  Scenario: A python condition that returns a non-boolean fails the gate
    Given an if/else gate whose python code returns a string
    When the workflow runs
    Then the gate errors stating the True or False contract
    And no branch executes
