@integration
Feature: MCP Scenario Management Tools
  As a coding agent
  I want to manage scenarios via the MCP server
  So that I can author and refine test scenarios for AI agents

  Background:
    Given the MCP server is configured with a valid API key

  # --- Scenario Authoring ---

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
      | name      | Login Flow Happy Path                     |
      | situation | User attempts to log in with valid creds  |
    And criteria ["Responds with a welcome message", "Includes user name in greeting"]
    And labels ["auth", "happy-path"]
    Then the response confirms the scenario was created
    And the response includes the new scenario ID

  Scenario: Agent creates a scenario with missing required fields
    When the agent calls create_scenario with an empty name
    Then the response contains a validation error

  Scenario: Agent updates an existing scenario
    Given a scenario exists with id "scen_abc123"
    When the agent calls update_scenario with:
      | scenarioId | scen_abc123                                |
      | name       | Login Flow - Valid Credentials             |
      | situation  | User logs in with correct email and pass   |
    And updated criteria ["Responds with welcome message", "Sets session cookie", "Redirects to dashboard"]
    Then the response confirms the scenario was updated
    And the response includes the updated scenario details

  Scenario: Agent updates a scenario that does not exist
    When the agent calls update_scenario with scenarioId "scen_nonexistent"
    Then the response contains an error message "Scenario not found"

  Scenario: Agent archives a scenario
    Given a scenario exists with id "scen_abc123"
    When the agent calls archive_scenario with scenarioId "scen_abc123"
    Then the response confirms the scenario was archived

  # --- Observability ---
  # Implementation must follow established patterns:
  # - REST layer: structured logging via createLogger("langwatch:api:scenarios")
  #   with projectId context on every request (see prompts app.v1.ts)
  # - Service layer: OpenTelemetry spans via getLangWatchTracer with tenant.id
  #   and entity.id attributes (already done in ScenarioService)
  # - Error paths: log at error level with structured context before returning
  #
  # --- OpenAPI Spec ---
  # After implementation, regenerate the OpenAPI spec to include the new
  # /api/scenarios routes (see generateOpenAPISpec.ts — add the scenarios
  # Hono app alongside the existing apps and include /api/scenarios in
  # the customMerge key list)

@unit
Feature: MCP Scenario Tool Formatters
  Scenario formatters produce AI-readable digest or raw JSON output

  Scenario: List scenarios digest includes expected fields per scenario
    Given a list of scenarios with names, situations, criteria, and labels
    When the formatter produces digest output
    Then each scenario includes id, name, situation preview, criteria count, and labels

  Scenario: List scenarios JSON format returns raw data
    Given a list of scenarios
    When the formatter produces JSON output
    Then the response is valid parseable JSON matching the scenario structure

  Scenario: Get scenario JSON format returns raw data
    Given a single scenario with full details
    When the formatter produces JSON output
    Then the response is valid parseable JSON matching the scenario structure

  Scenario: Discover scenario schema returns field metadata
    When the schema formatter produces scenario schema output
    Then the response includes field descriptions for name, situation, criteria, and labels
    And the response includes target types (prompt, http, code)
    And the response includes examples of good criteria
