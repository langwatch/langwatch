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

  # The if/else inputs use the same modern field editor as the code and LLM
  # nodes (a compact type-icon + name row with mappings and an Add menu), so
  # every input type those nodes accept is available here too, including image.
  @integration
  Scenario: The if/else inputs use the shared field editor
    Given an if/else node with input "context"
    When I open the node's properties panel
    Then the inputs use the same field editor as the code and LLM nodes
    And the input type options include image

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

  # The node emits both branch handles for routing, but the run results
  # panel must read clearly: a single condition outcome, not two boxes
  # ("FALSE: true", "TRUE: false") that look contradictory.
  @integration
  Scenario: The if/else result shows a single condition value
    Given an if/else node that has been run
    When I view the node's outputs in the drawer
    Then I see a single condition result of true or false
    And not separate true and false branch boxes

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

  # The liquid condition is easy to get wrong silently, so the field
  # validates live (the same way the engine parses it) and frames itself
  # with {% %} so it reads as a Liquid expression.
  @integration
  Scenario: The condition flags invalid Liquid syntax
    Given an if/else node with a liquid condition
    When I type a malformed expression
    Then the condition shows an error explaining the syntax is invalid

  @integration
  Scenario: The condition warns when it references an unknown input
    Given an if/else node with input "amount"
    When I type a condition referencing a variable that is not an input
    Then the condition warns that the variable is not a known input

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

  # Dataset cells and form fields arrive as strings; an input declared as a
  # number must reach python code as a number so comparisons work. This is
  # the input type coercion the python engine did (autoparse_field_value),
  # restored for the Go code-execution paths.
  @integration
  Scenario: A string dataset value is coerced to the declared input type
    Given an if/else gate with a python condition comparing a float input
    And the input is fed a numeric string from the dataset
    When the workflow runs
    Then the input is coerced to a number before the condition runs
    And the gate evaluates without a type error

  # The default liquid condition needs the same coercion: a numeric string
  # compared against a number in Liquid is a type mismatch that silently
  # routes false for every value, so "6 > 5" wrongly reads as false. The
  # input must reach Liquid as a number, like the python path.
  @integration
  Scenario: A liquid condition coerces a numeric-string input before comparing
    Given an if/else gate with a liquid condition comparing a float input
    And the input is fed a numeric string from the dataset
    When the workflow runs
    Then the input is coerced to a number before the condition runs
    And "6 > 5" routes the true branch while "4 > 5" routes the false branch

  # ============================================================================
  # Branch-to-gate connections (drag a branch onto a downstream node)
  # ============================================================================

  # A branch routes execution AND carries its boolean value: it connects like
  # a normal edge into any bool input. To make wiring obvious, dragging a
  # branch grows a temporary green "gate" bool input on every connectable node
  # that does not already have one; dropping onto it materializes a real
  # "gate" input wired to the branch. The engine gates the target on the
  # branch and passes the branch boolean into its gate input.

  @integration
  Scenario: Every node grows a temporary gate input while dragging a branch
    Given an if/else node and a downstream node with no gate input
    When I start dragging from the if/else "true" branch handle
    Then a temporary green "gate" bool input appears as the last input on every connectable node
    And it is styled like an input row, in green, while the branch is held

  @integration
  Scenario: The temporary gate is not offered when the node already has one
    Given an if/else node and a downstream node that already has a "gate" input
    When I start dragging from the if/else "true" branch handle
    Then no second temporary "gate" input appears on that node

  @integration
  Scenario: Connecting a branch to the temporary gate adds a real gate input
    Given an if/else node and a code node with no gate input
    When I connect the if/else "true" branch to the code node's temporary gate
    Then the code node gains a real "gate" bool input wired to the branch
    And the temporary gate rows on the other nodes disappear

  # A branch carries a boolean, so it may only land on a bool input (an
  # existing bool input or the gate), never on a non-bool input row.
  @integration
  Scenario: A branch only connects to bool inputs
    Given an if/else node and a code node with a string input on the canvas
    When I drag the if/else "true" branch over the code node's string input
    Then the connection is not allowed onto the non-bool input
    And the branch may still land on a bool input or the gate

  @integration
  Scenario: The branch value flows into the gate input
    Given a code node connected from an if/else "true" branch into its bool gate input
    When the workflow runs and the true branch is taken
    Then the code node runs and receives the branch boolean in its gate input

  @integration
  Scenario: A node behind a not-taken branch is skipped
    Given a code node connected from an if/else "false" branch into its bool gate input
    When the workflow runs and the condition is true
    Then the code node is skipped because its branch was not taken
