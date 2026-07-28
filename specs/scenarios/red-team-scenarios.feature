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

  # Enforced on every surface rather than in the editor alone: without an
  # objective the run falls back to the cooperative user simulator, so the
  # scenario looks configured, no attack happens, and the judge reports that
  # the agent held up.
  @unit
  Scenario: A strategy with no objective is refused
    When a scenario is saved with a strategy but no attack objective
    Then it is rejected with an error naming the objective
    And no scenario is stored with a strategy it cannot act on

  # GOAT reasons turn by turn and never generates a plan, so the SDK ignores
  # both planner settings for it.
  @unit
  Scenario: Planner settings are refused on a strategy that ignores them
    When a GOAT scenario is saved with an attack plan or planning prompt
    Then it is rejected rather than accepted and silently ignored

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

  # Every way in has to persist the configuration, not just the one someone
  # happened to test. The REST route shipped validating these fields and never
  # sending them: it answered 201 with them echoed back as null and stored a
  # standard scenario, so a caller got a cooperative user simulator where they
  # asked for an attack — and the run still returned a verdict, which reads as
  # the agent holding up. Hence a scenario per surface rather than one that
  # says "a scenario is created".

  @unit
  Scenario Outline: Configuring an attack persists it, whichever way it was created
    When a scenario is created through <surface> with a strategy, objective, and turn count
    Then those values are stored on the scenario
    And reading the scenario back reports the same attack

    Examples:
      | surface        |
      | the editor     |
      | the REST API   |
      | the CLI        |

  @unit
  Scenario: Clearing the attack turns the scenario back into a standard one
    Given a red-team scenario exists
    When the attack is cleared
    Then the scenario has no strategy, objective, turn count, or tuning

  @unit
  Scenario: An objective of only whitespace is refused
    When a scenario is created with an objective of only spaces
    Then the request is rejected
    And no scenario is stored

  @unit
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

  # An attack that ends early because the pipeline ran out of room still
  # reports a verdict, and that verdict reads as "the agent held up". The turn
  # budget the person configured has to be the budget the attack actually gets.
  @unit @unimplemented
  Scenario: The attack gets every turn it was configured for
    Given a red-team scenario configured for 30 turns
    When the run executes
    Then the attacker is given 30 turns to work with
    And a run that ends sooner ends because the objective was met

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
