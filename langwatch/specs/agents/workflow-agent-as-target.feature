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

  Scenario: Editing the target opens the underlying Studio workflow
    Given the workflow agent is added as a target in the Experiments Workbench
    When the user opens the target's edit menu and selects Edit Agent
    Then the linked Studio workflow opens in a new tab
    And the workbench keeps its own state, since a full graph editor
      cannot be edited meaningfully inside a narrow sidebar drawer

  Scenario: Switching away from a workflow target
    Given the workflow agent is added as a target in the Experiments Workbench
    When the user switches the target to a different agent
    Then the column updates to show the newly selected agent
