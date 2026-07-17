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

  Scenario: Editing the target opens the workflow in a sidebar
    Given the workflow agent is added as a target in the Experiments Workbench
    When the user opens the target's edit menu
    Then the workflow opens in a sidebar drawer within the workbench
    And the workbench does not navigate away or open a new tab

  Scenario: Switching away from a workflow target
    Given the workflow agent is added as a target in the Experiments Workbench
    When the user switches the target to a different agent
    Then the column updates to show the newly selected agent
