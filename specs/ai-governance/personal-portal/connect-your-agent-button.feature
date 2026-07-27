Feature: The personal surface's agent button says what it does
  As a /me user looking at my empty personal traces page
  I want the agent button to read as an action with an outcome
  So that I understand it connects my coding agent, not that it configures some abstract setup

  # The SetupWithAgentButton component is shared: suites and other shared-project
  # empty states really do "set up" a feature there, so they keep "Setup via
  # Agent". The personal surface is about connecting your own agent, so it says
  # so. The label is a per-surface prop with "Setup via Agent" as the default.

  @bdd @personal-portal @button-copy @unit
  Scenario: the personal traces empty state labels the button "Connect your agent"
    Given the traces integrate pane renders for a personal project
    Then the agent menu button reads "Connect your agent"

  @bdd @personal-portal @button-copy @unit
  Scenario: shared-project surfaces keep "Setup via Agent"
    Given the traces integrate pane renders for a shared project
    Then the agent menu button reads "Setup via Agent"
    And the suites empty states keep "Setup via Agent" unchanged
