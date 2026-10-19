Feature: The analytics overview leads with setup only until a project has traces

  The overview's "No traces received yet" prompt reads whether the project has
  ever received a trace, as main read project.firstMessage.

  @integration
  Scenario: A project that has received traces shows no setup prompt
    Given the analytics host mounted over a project that has received a trace
    When a screen reads the host's project
    Then the project reports that it has received its first message

  @integration
  Scenario: A project that has never received a trace leads with the setup prompt
    Given the analytics host mounted over a project that has never received a trace
    When a screen reads the host's project
    Then the project reports that it has not received its first message

  @integration
  Scenario: The setup prompt does not flash while the answer is loading
    Given the analytics host mounted over a project whose answer has not arrived
    When a screen reads the host's project
    Then the project is not reported as missing its first message
