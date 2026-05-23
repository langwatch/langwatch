@unimplemented
Feature: CLI Projects and API Keys management
  As an engineer or code assistant using the LangWatch CLI
  I want to manage projects and API keys via org-level commands
  So that I can programmatically set up and administer LangWatch without the web UI

  Background:
    Given I have a valid API key configured via LANGWATCH_API_KEY with org-level permissions

  # ── Projects ────────────────────────────────────────────────────

  @integration
  Scenario: List projects in the organization
    Given the organization has at least one project
    When I run `langwatch projects list`
    Then the output displays a table with project ID, Name, Slug, Language, Framework, and Created columns
    And the CLI exits with status 0

  @integration
  Scenario: List projects with JSON output
    Given the organization has at least one project
    When I run `langwatch projects list --format json`
    Then the output is valid JSON containing a "data" array and "pagination" object
    And the CLI exits with status 0

  @integration
  Scenario: Create a new project with a new team
    When I run `langwatch projects create --name "Test Project" --language python --framework langchain --new-team-name "Test Team"`
    Then the output includes a warning to save the service API key
    And the output includes the one-time service API key value
    And the output includes the project ID and slug
    And the CLI exits with status 0

  @integration
  Scenario: Create a project outputs JSON with service key
    When I run `langwatch projects create --name "JSON Project" --language typescript --framework openai --new-team-name "Team" --format json`
    Then the output is valid JSON containing "serviceApiKey" and "serviceApiKeyId"
    And the CLI exits with status 0

  @integration
  Scenario: Create a project fails without team
    When I run `langwatch projects create --name "No Team" --language python --framework langchain`
    Then the output includes "either --team-id or --new-team-name is required"
    And the CLI exits with status 1

  @integration
  Scenario: Get project details by ID
    Given a project exists with a known ID
    When I run `langwatch projects get <project-id>`
    Then the output displays project ID, Name, Slug, Language, Framework, Team ID, PII Redaction, Created, and Updated
    And the CLI exits with status 0

  @integration
  Scenario: Update a project's name
    Given a project exists with a known ID
    When I run `langwatch projects update <project-id> --name "Renamed"`
    Then the output confirms the project was updated
    And the output shows the new name "Renamed"
    And the CLI exits with status 0

  @integration
  Scenario: Update with no fields fails
    When I run `langwatch projects update <project-id>`
    Then the output includes "nothing to update"
    And the CLI exits with status 1

  @integration
  Scenario: Delete (archive) a project
    Given a project exists with a known ID
    When I run `langwatch projects delete <project-id>`
    Then the output confirms the project was archived
    And the output includes an "Archived at" timestamp
    And the CLI exits with status 0

  # ── API Keys ────────────────────────────────────────────────────

  @integration
  Scenario: List API keys in the organization
    When I run `langwatch api-keys list`
    Then the output displays a table with ID, Name, Status, Bindings, Expires, Last used, and Created columns
    And the CLI exits with status 0

  @integration
  Scenario: Create a service API key
    When I run `langwatch api-keys create --name "CI Key"`
    Then the output includes a warning to save the token
    And the output includes the one-time token value
    And the output includes the API key ID
    And the CLI exits with status 0

  @integration
  Scenario: Create a service API key scoped to projects
    When I run `langwatch api-keys create --name "Scoped Key" --project-id proj_1 --project-id proj_2`
    Then the output includes the one-time token value
    And the CLI exits with status 0

  @integration
  Scenario: Revoke an API key
    Given an API key exists with a known ID
    When I run `langwatch api-keys revoke <key-id>`
    Then the output confirms the key was revoked
    And the CLI exits with status 0

  # ── Auth ─────────────────────────────────────────────────────────

  @integration
  Scenario: Fails with helpful message when no API key is set
    Given LANGWATCH_API_KEY is not set
    When I run `langwatch projects list`
    Then the output includes "LANGWATCH_API_KEY not found"
    And the CLI exits with status 1
