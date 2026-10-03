Feature: Workflow reasoning settings
  As an experiment author
  I want my reasoning setting to reach the model
  So that comparisons use the selected reasoning level

  @integration @regression
  Scenario: Workflow execution preserves each supported reasoning setting
    Given a prompt configured with reasoning, reasoning_effort, thinkingLevel, or effort
    When I run the workflow
    Then the model request includes the selected reasoning value
    And an explicit "none" remains "none"

  @integration @regression
  Scenario: Workflow execution resolves conflicting reasoning settings
    Given a prompt with multiple reasoning settings
    When I run the workflow
    Then the first nonempty value wins in the order reasoning, reasoning_effort, thinkingLevel, effort

  @integration @regression
  Scenario: Workflow execution omits unset reasoning settings
    Given a prompt whose reasoning settings are absent, null, or empty
    When I run the workflow
    Then the model request omits the reasoning setting
