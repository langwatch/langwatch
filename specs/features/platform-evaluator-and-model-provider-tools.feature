Feature: Platform MCP tools for evaluators and model providers
  As an AI agent using the LangWatch MCP server
  I want to manage evaluators and model providers on the platform
  So that I can set up LLM-as-judge evaluators and configure the API keys needed to run them

  Background:
    Given the MCP server is connected with a valid LangWatch API key

  # --- Evaluator Tools ---

  @integration
  Scenario: List all evaluators for a project
    Given the project has evaluators configured
    When I call the platform_list_evaluators tool
    Then I receive a formatted digest of all evaluators
    And each evaluator shows its name, ID, type, and category

  @integration
  Scenario: Get evaluator details by ID or slug
    Given an evaluator exists in the project
    When I call platform_get_evaluator with that ID or slug
    Then I receive the full evaluator details
    And the response includes config, fields, and output fields

  @integration
  Scenario: Create a built-in evaluator
    Given I know the evaluator type from discover_schema
    When I call platform_create_evaluator with name and config
    Then a new evaluator is created on the platform
    And the response includes the generated ID and slug

  @integration
  Scenario: Update an existing evaluator
    Given an evaluator exists on the platform
    When I call platform_update_evaluator with updated name or config
    Then the evaluator is updated
    And the evaluatorType in config cannot be changed after creation

  # --- Evaluator Schema Discovery ---
  # Two-level discovery: list types with one-line descriptions first,
  # full detail only for a specific evaluator type on request.

  @unit
  Scenario: Discover evaluator types overview
    When I call discover_schema with category "evaluators"
    Then I receive a compact list of all evaluator types
    And each entry shows only name, category, and one-line description
    And it instructs the agent to use evaluatorType parameter for full details

  @unit
  Scenario: Discover specific evaluator type details
    When I call discover_schema with category "evaluators" and evaluatorType "langevals/llm_judge"
    Then I receive the full schema for that evaluator type
    And it includes settings with descriptions and defaults
    And it includes required/optional fields and env vars

  # --- Hono Endpoints for Evaluators (missing: update and archive) ---

  @integration
  Scenario: PUT /api/evaluators/:id updates an evaluator
    Given an evaluator exists with a known ID
    When I send a PUT request with updated name and config
    Then the evaluator is updated in the database
    And the evaluatorType in config is immutable
    And the response matches the apiResponseEvaluatorSchema

  @integration
  Scenario: DELETE /api/evaluators/:id archives an evaluator
    Given an evaluator exists with a known ID
    When I send a DELETE request for that evaluator
    Then the evaluator archivedAt is set
    And subsequent GET requests return 404

  # --- Model Provider Tools ---

  @integration
  Scenario: List all model providers for a project
    When I call platform_list_model_providers
    Then I receive all configured model providers
    And API keys are masked in the response
    And each provider shows its name, enabled status, and which key fields are set

  @integration
  Scenario: Set or update a model provider
    When I call platform_set_model_provider with provider name and API key
    Then the provider is created if it does not exist or updated if it does
    And the provider is enabled
    And the API key value is never returned in any response

  @integration
  Scenario: Update model provider without changing keys
    When I call platform_set_model_provider with only non-key fields
    Then the provider settings are updated
    And existing keys are preserved (omitted fields are not overwritten)

  # --- Hono Endpoints for Model Providers (greenfield) ---

  @integration
  Scenario: GET /api/model-providers lists providers with masked keys
    When I send a GET request to /api/model-providers
    Then I receive all providers for the project
    And all API key values are masked

  @integration
  Scenario: PUT /api/model-providers/:provider upserts provider config
    When I send a PUT request with provider name and customKeys
    Then the provider is created or updated (upsert)
    And the response confirms the provider is enabled
    And API keys are masked in the response
    And omitted fields are not overwritten
