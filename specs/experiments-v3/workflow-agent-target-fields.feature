# A "workflow agent" is an Agent row of type "workflow": a name and an icon
# pointing at a Studio workflow. Unlike a code or HTTP agent, its saved config
# holds no inputs and no outputs, so the fields it really reads and produces
# only exist in the linked workflow's DSL: the entry node's outputs are what it
# reads, and the end node's inputs (labelled RESULTS in the Studio) are what it
# produces.
#
# Bindings target [gone] src/server/agents/__tests__/,
# [gone] src/experiments-v3/__tests__/ and
# [gone] src/server/experiments-v3/execution/__tests__/.
Feature: A workflow agent exposes its real fields as an evaluations target
  As an author evaluating a Studio workflow from the experiments workbench
  I want the workflow's own inputs and results to be what I map against
  So that an evaluator can grade any result the workflow produces, not just one
  invented field named "output".

  Background:
    Given a project with a workflow whose entry node declares "question"
    And whose end node declares the results "output" of type text and "chunks" of type object
    And a workflow agent linked to that workflow

  # ==========================================================================
  # Deriving the fields from the linked workflow
  # ==========================================================================

  @integration
  Scenario: A workflow agent reports the end node's results as its output fields
    When I read the agent
    Then its output fields are "output" and "chunks"
    And "chunks" keeps its declared object type

  @integration
  Scenario: A workflow agent reports the entry node's fields as its input fields
    When I read the agent
    Then its input fields are "question"

  @integration
  Scenario: Editing the workflow changes the agent's fields without touching the agent
    Given the agent already reports "output" and "chunks"
    When a result named "citations" is added to the workflow's end node
    And I read the agent again
    Then its output fields are "output", "chunks" and "citations"

  @integration
  Scenario: A workflow agent whose workflow declares no results reports none
    Given the linked workflow has no end node results
    When I read the agent
    Then its output fields are empty
    And no field named "output" is invented for it
    And the agent reports that it resolved those fields

  # Deleting a workflow archives it: the delete endpoint sets archivedAt and
  # the row stays. A workflow id matching no row at all is the rarer case, an
  # agent copied into a project its workflow was never copied to.
  @integration
  Scenario: A workflow agent whose workflow was deleted reports no fields
    Given the linked workflow was deleted, which archives it
    When I read the agent
    Then its output fields are empty
    And reading the agent still succeeds
    And the agent reports that it could not resolve them

  @integration
  Scenario: A workflow agent pointing at no workflow at all reports no fields
    Given the agent's workflow id matches no workflow in the project
    When I read the agent
    Then its output fields are empty
    And the agent reports that it could not resolve them

  # "Declares nothing" and "could not be read" are both an empty list, and a
  # caller that cannot tell them apart has to pick one wrong behaviour for
  # both: clear a column the first time a lookup fails, or keep offering a
  # result the author removed. So the agent says which of the two it means.

  @unit
  Scenario: A code agent keeps reporting the fields saved on its own config
    Given a code agent whose config declares the output "answer"
    When I read the agent
    Then its output fields are "answer"

  # ==========================================================================
  # The workbench target
  # ==========================================================================

  @integration
  Scenario: Adding a workflow agent as a target offers every result to an evaluator
    When I add the workflow agent as a target in the experiments workbench
    And I open an evaluator and pick a source for one of its variables
    Then the target offers both "output" and "chunks"
    And "chunks" is badged as an object rather than as text

  @integration
  Scenario: A target added before the fields were derived recovers on load
    Given a saved workbench whose workflow agent target records only "output"
    When I open that workbench
    Then the target records "output" and "chunks"
    And an evaluator opened against it offers both

  @integration
  Scenario: A target does not lose its recorded fields when the workflow cannot be read
    Given a saved workbench whose workflow agent target records "output" and "chunks"
    When I open that workbench and the linked workflow fails to load
    Then the target still records "output" and "chunks"

  @integration
  Scenario: A target drops a result its workflow no longer declares
    Given a saved workbench whose workflow agent target records "output" and "chunks"
    When the workflow's end node no longer declares any result
    And I open that workbench
    Then the target records no fields
    And the evaluator no longer offers "output"

  # Auto-inference across several outputs is already specified in
  # mapping-auto-inference.feature; deriving the real results is what lets it
  # apply here at all, since one invented output always looked unambiguous.

  # ==========================================================================
  # Grading a workflow target
  # ==========================================================================

  @integration
  Scenario: An evaluator attached to a workflow target runs against its results
    Given an evaluator on the workflow target reading "output"
    When I run the evaluation
    Then the evaluator produces a score for each row

  @integration
  Scenario: An evaluator can read a result other than the first one
    Given an evaluator on the workflow target reading "chunks"
    When I run the evaluation
    Then the evaluator receives the workflow's "chunks" result

  @integration
  Scenario: A failing workflow row does not run its evaluators
    Given the workflow fails on a row
    When I run the evaluation
    Then that row reports the workflow error
    And no evaluator score is invented for it

  @integration
  Scenario: An evaluator that fails does not lose the workflow's own result
    Given an evaluator on the workflow target that errors
    When I run the evaluation
    Then the row still shows the workflow's result
    And the evaluator cell reports its error
