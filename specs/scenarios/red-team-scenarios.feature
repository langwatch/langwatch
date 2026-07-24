Feature: Red Team Scenarios
  As a LangWatch user
  I want to configure and run adversarial red-team tests from the platform
  So that I can probe my agent for weaknesses without writing code

  Background:
    Given I am logged into project "my-project"

  # ============================================================================
  # Configuring a red-team scenario
  # ============================================================================

  @integration @unimplemented
  Scenario: Switch a scenario to red team
    Given I am editing a scenario
    When I select the "Red team" scenario type
    Then I see an option to configure the attack

  @integration @unimplemented
  Scenario: Configure the attack
    Given I am editing a red-team scenario
    When I open the attack configuration
    And I pick a strategy
    And I enter an attack objective
    And I set the number of turns
    And I save the configuration
    Then the scenario records the strategy, objective, and turn count

  @integration @unimplemented
  Scenario: An attack objective is required
    Given I am editing a red-team scenario
    When I open the attack configuration
    And I leave the attack objective empty
    Then I cannot save the configuration

  @unit @unimplemented
  Scenario: Turn count is bounded
    Given a red-team scenario configuration
    When the turn count is above the allowed maximum
    Then the configuration is rejected

  @integration @unimplemented
  Scenario: A standard scenario carries no red-team configuration
    Given I am editing a scenario
    When I select the "Standard" scenario type
    Then the scenario has no strategy, objective, or turn count

  # ============================================================================
  # Persistence and passthrough
  # ============================================================================

  @unit @unimplemented
  Scenario: Creating a scenario accepts red-team configuration
    When a scenario is created with a strategy, objective, and turn count
    Then those values are stored on the scenario

  @unit @unimplemented
  Scenario: Red-team configuration reaches the run
    Given a red-team scenario exists
    When a run is prepared for it
    Then the run configuration carries the strategy, objective, and turn count

  # ============================================================================
  # Execution
  # ============================================================================
  # A red-team attacker is a user simulator, so it runs through the same
  # pipeline as any other scenario. Only the simulator differs.

  @unit @unimplemented
  Scenario: A red-team run uses the attacker instead of the standard user simulator
    Given a red-team scenario with a strategy
    When the run executes
    Then the attacker drives the conversation instead of the standard user simulator

  @unit @unimplemented
  Scenario: A standard run is unaffected
    Given a scenario with no strategy
    When the run executes
    Then the standard user simulator drives the conversation

  # The attacker's turn budget and the run's own turn ceiling are separate
  # settings. If only the attacker's budget is applied, a long attack is cut
  # short by the run's default ceiling and silently under-tests the agent.
  @unit @unimplemented
  Scenario: The run allows as many turns as the attack is configured for
    Given a red-team scenario configured for 30 turns
    When the run executes
    Then the run allows at least 30 turns
    And the attack is not cut short by the default turn ceiling

  @unit @unimplemented
  Scenario: Success criteria are still judged
    Given a red-team scenario with success criteria
    When the run finishes
    Then the criteria are judged as they are for any other scenario

  # ============================================================================
  # Results
  # ============================================================================

  @e2e @unimplemented
  Scenario: A red-team run appears alongside other runs
    Given a red-team scenario has finished running
    When I open the run
    Then I see the conversation and verdict in the usual run view
