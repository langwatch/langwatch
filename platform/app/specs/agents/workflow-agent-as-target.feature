Feature: Workflow agent as an experiment target
  When a user builds a workflow in Optimization Studio and saves it as an agent,
  they can add that agent as a comparison target in the Experiments Workbench
  and run it like any other target.

  Background:
    Given the user has a workflow built in Optimization Studio
    And the user has saved the workflow as an agent

  Scenario: Running the experiment executes the underlying workflow
    Given the workflow agent is added as a target in the Experiments Workbench
    When the user runs the experiment
    Then each row executes the agent's workflow
    And no row shows a code validation error

  Scenario: The target column shows a workflow icon
    Given the workflow agent is added as a target in the Experiments Workbench
    Then the target column shows a workflow icon, not a code icon

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

  Scenario: Mapping a dataset column to a workflow input field
    Given the workflow agent target's drawer is open
    And the underlying workflow declares an input field named "question"
    When the user maps "question" to a dataset column
    Then the mapping is saved immediately, without a separate save step
    And running the experiment passes that column's value into the
      workflow's "question" input

  Scenario: Switching away from a workflow target
    Given the workflow agent is added as a target in the Experiments Workbench
    When the user switches the target to a different agent
    Then the column updates to show the newly selected agent
