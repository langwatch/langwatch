@integration @unimplemented
Feature: MCP Project Tools
  As a coding agent
  I want to manage projects via the MCP server
  So that I can create, inspect, and configure LangWatch projects programmatically

  Background:
    Given the MCP server is configured with an org-level API key

  Scenario: Agent lists all projects in the organization
    Given the organization has projects configured
    When the agent calls platform_list_projects
    Then the response contains a list of projects
    And each project includes id, name, slug, language, and framework
    And the response includes pagination information

  Scenario: Agent lists projects with pagination
    Given the organization has more than 10 projects
    When the agent calls platform_list_projects with page 2 and limit 5
    Then the response contains at most 5 projects
    And the pagination shows the correct page and total pages

  Scenario: Agent lists projects in an empty organization
    Given the organization has no projects
    When the agent calls platform_list_projects
    Then the response indicates no projects were found
    And the response suggests using platform_create_project

  Scenario: Agent gets a project by ID
    Given a project exists with id "proj_abc123"
    When the agent calls platform_get_project with id "proj_abc123"
    Then the response includes the project name, slug, language, and framework
    And the response includes the team ID and PII redaction level

  Scenario: Agent creates a new project with an existing team
    When the agent calls platform_create_project with:
      | name      | My Agent Project |
      | language  | python           |
      | framework | openai           |
      | teamId    | team_existing    |
    Then the response confirms the project was created
    And the response includes the new project ID and slug
    And the response includes a one-time service API key
    And the response warns to save the API key immediately

  Scenario: Agent creates a new project with a new team
    When the agent calls platform_create_project with:
      | name        | My Agent Project |
      | language    | typescript       |
      | framework   | langchain        |
      | newTeamName | Engineering      |
    Then the response confirms the project was created
    And the response includes a one-time service API key

  Scenario: Agent updates a project's name and PII settings
    Given a project exists with id "proj_abc123"
    When the agent calls platform_update_project with:
      | id                | proj_abc123 |
      | name              | Renamed     |
      | piiRedactionLevel | STRICT      |
    Then the response confirms the project was updated
    And the response shows the updated name and PII level

  Scenario: Agent archives a project
    Given a project exists with id "proj_abc123"
    When the agent calls platform_archive_project with id "proj_abc123"
    Then the response confirms the project was archived
    And the response includes the archive timestamp

  Scenario: Agent calls project tools without org-level permissions
    Given the API key lacks org-level permissions
    When the agent calls platform_list_projects
    Then the request fails with a 403 Forbidden error
    And the error message indicates insufficient permissions
