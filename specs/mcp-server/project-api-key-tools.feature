@integration @unimplemented
Feature: MCP Project and API Key management tools
  As a coding agent using the LangWatch MCP server
  I want to manage projects and API keys via MCP tools
  So that I can set up and administer LangWatch programmatically from my IDE

  Background:
    Given the MCP server is configured with a valid org-level API key

  # ── Project tools ───────────────────────────────────────────────

  @unimplemented
  Scenario: Agent lists all projects
    Given the organization has projects
    When the agent calls platform_list_projects
    Then the response contains a list of projects with id, name, slug, language, and framework
    And the response includes pagination metadata

  @unimplemented
  Scenario: Agent lists projects with pagination
    When the agent calls platform_list_projects with page 2 and limit 10
    Then the response pagination shows page 2

  @unimplemented
  Scenario: Agent creates a project
    When the agent calls platform_create_project with:
      | name        | New AI Project |
      | language    | python         |
      | framework   | langchain      |
      | newTeamName | Dev Team       |
    Then the response confirms the project was created
    And the response includes the one-time service API key
    And the response includes a warning that the key will not be shown again

  @unimplemented
  Scenario: Agent gets a project by ID
    Given a project exists with ID "proj_abc123"
    When the agent calls platform_get_project with id "proj_abc123"
    Then the response includes the project name, slug, language, framework, and team ID

  @unimplemented
  Scenario: Agent updates a project
    Given a project exists with ID "proj_abc123"
    When the agent calls platform_update_project with id "proj_abc123" and name "Renamed Project"
    Then the response confirms the project was updated
    And the response shows the new name

  @unimplemented
  Scenario: Agent archives a project
    Given a project exists with ID "proj_abc123"
    When the agent calls platform_archive_project with id "proj_abc123"
    Then the response confirms the project was archived
    And the response includes an archived timestamp

  # ── API Key tools ───────────────────────────────────────────────

  @unimplemented
  Scenario: Agent lists API keys
    When the agent calls platform_list_api_keys
    Then the response contains a list of API keys with id, name, status, and role bindings

  @unimplemented
  Scenario: Agent creates a service API key
    When the agent calls platform_create_api_key with:
      | keyType | service    |
      | name    | CI Deploy  |
    Then the response includes the one-time token
    And the response includes the API key ID and creation timestamp
    And the response includes a warning that the token will not be shown again

  @unimplemented
  Scenario: Agent creates a project-scoped service key
    When the agent calls platform_create_api_key with keyType "service", name "Scoped Key", and projectIds ["proj_1", "proj_2"]
    Then the response includes the one-time token
    And the key is scoped to the specified projects

  @unimplemented
  Scenario: Agent revokes an API key
    Given an API key exists with ID "key_abc123"
    When the agent calls platform_revoke_api_key with id "key_abc123"
    Then the response confirms the key was revoked

  # ── Error handling ──────────────────────────────────────────────

  @unimplemented
  Scenario: Tool returns actionable error when org key is missing
    Given the MCP server is configured without an org-level API key
    When the agent calls platform_list_projects
    Then the response includes an error message mentioning "org-level API key"
    And the response isError flag is true
