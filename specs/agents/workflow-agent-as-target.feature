# Execution of the workflow itself is NOT specified here — that lives in
# specs/experiments-v3/workflow-target.feature ("A workflow target produces one
# result per dataset row"), which already binds it. This file covers only what
# is specific to reaching a workflow through an *agent* target: how the column
# is labelled, and what editing that target gives you.
Feature: Workflow agent as an experiment target
  When a user builds a workflow in Optimization Studio and saves it as an agent,
  they can add that agent as a comparison target in the Experiments Workbench
  and run it like any other target.

  Background:
    Given the user has a workflow built in Optimization Studio
    And the user has saved the workflow as an agent

  @integration
  Scenario: The target column shows a workflow icon
    Given the workflow agent is added as a target in the Experiments Workbench
    Then the target column shows a workflow icon, not a code icon

  @integration
  Scenario: Editing the target opens a mapping drawer, not a dead end
    Given the workflow agent is added as a target in the Experiments Workbench
    When the user opens the target's edit menu and selects Edit Agent
    Then a sidebar drawer opens showing the linked workflow's name
    And an "Open Workflow" action in that drawer opens the Studio graph
      editor in a new tab, since a full graph editor cannot be edited
      meaningfully inside a narrow sidebar
    And below it, the drawer shows the workflow's real input fields
      with mapping controls, matching the mapping UI code and HTTP
      agent targets already get

  @integration
  Scenario: Mapping a dataset column to a workflow input field
    Given the workflow agent target's drawer is open
    And the underlying workflow declares an input field named "question"
    When the user maps "question" to a dataset column
    Then the mapping is recorded immediately, without a separate save step
    And the drawer offers no save control to press

  @unimplemented
  Scenario: A mapped column reaches the workflow input at run time
    Given "question" is mapped to a dataset column
    When the user runs the experiment
    Then that column's value is passed into the workflow's "question" input

  @unimplemented
  Scenario: Switching away from a workflow target
    Given the workflow agent is added as a target in the Experiments Workbench
    When the user switches the target to a different agent
    Then the column updates to show the newly selected agent
