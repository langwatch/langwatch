@integration
Feature: MCP Scenario Management Tools
  As a coding agent
  I want to manage scenarios via the MCP server
  So that I can author and refine test scenarios for AI agents

  Background:
    Given the MCP server is configured with a valid API key

  Scenario: Agent lists all scenarios in a project
    Given the project has scenarios configured
    When the agent calls list_scenarios
    Then the response contains a list of scenarios

  Scenario: Agent lists scenarios when none exist
    Given the project has no scenarios
    When the agent calls list_scenarios
    Then the response contains a message "No scenarios found"
    And the response includes a tip to use create_scenario

  Scenario: Agent gets full details of a scenario
    Given a scenario exists with id "scen_abc123"
    When the agent calls get_scenario with scenarioId "scen_abc123"
    Then the response includes the scenario name, situation, criteria, and labels

  Scenario: Agent gets a scenario that does not exist
    When the agent calls get_scenario with scenarioId "scen_nonexistent"
    Then the response contains an error message "Scenario not found"

  Scenario: Agent creates a new scenario
    When the agent calls create_scenario with:
      | field     | value                                    |
      | name      | Login Flow Happy Path                    |
      | situation | User attempts to log in with valid creds |
    And criteria:
      | criterion                        |
      | Responds with a welcome message  |
      | Includes user name in greeting   |
    And labels:
      | label      |
      | auth       |
      | happy-path |
    Then the response confirms the scenario was created
    And the response includes the new scenario ID

  Scenario: Agent creates a scenario with missing required fields
    When the agent calls create_scenario with an empty name
    Then the response contains a validation error

  Scenario: Agent updates an existing scenario
    Given a scenario exists with id "scen_abc123"
    When the agent calls update_scenario with:
      | field      | value                                  |
      | scenarioId | scen_abc123                            |
      | name       | Login Flow - Valid Credentials         |
      | situation  | User logs in with correct email and pass |
    And updated criteria:
      | criterion                      |
      | Responds with welcome message  |
      | Sets session cookie            |
      | Redirects to dashboard         |
    Then the response confirms the scenario was updated
    And the response includes the updated scenario details

  Scenario: Agent updates a scenario that does not exist
    When the agent calls update_scenario with scenarioId "scen_nonexistent"
    Then the response contains an error message "Scenario not found"

  Scenario: Agent archives a scenario
    Given a scenario exists with id "scen_abc123"
    When the agent calls archive_scenario with scenarioId "scen_abc123"
    Then the response confirms the scenario was archived
