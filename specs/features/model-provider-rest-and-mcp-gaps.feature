Feature: Model Provider REST API and MCP tool gaps
  As a developer or AI agent integrating with LangWatch
  I want complete CRUD and validation endpoints for model providers
  So that I can fully manage provider configurations programmatically without using the UI

  Background:
    Given a project with a valid API key
    And the "openai" model provider is configured with an API key

  # --- REST API: GET single provider ---

  @integration
  Scenario: GET /api/model-providers/:provider returns a single provider with masked keys
    When I send a GET request to /api/model-providers/openai
    Then I receive the "openai" provider configuration
    And API key values are replaced with the masked key placeholder
    And non-secret fields like endpoint URLs are preserved unmasked

  @integration
  Scenario: GET /api/model-providers/:provider returns 404 for unconfigured provider
    When I send a GET request to /api/model-providers/nonexistent
    Then I receive a 404 response

  # --- REST API: DELETE provider ---

  @integration
  Scenario: DELETE /api/model-providers/:provider removes a provider
    When I send a DELETE request to /api/model-providers/openai
    Then I receive a success response
    And GET /api/model-providers/openai returns 404

  @integration
  Scenario: DELETE /api/model-providers/:provider returns 404 for unconfigured provider
    When I send a DELETE request to /api/model-providers/nonexistent
    Then I receive a 404 response

  # --- REST API: Validate provider key ---

  @integration
  Scenario: POST /api/model-providers/:provider/validate returns valid for a good key
    When I send a POST request to /api/model-providers/openai/validate with valid customKeys
    Then I receive { valid: true }

  @integration
  Scenario: POST /api/model-providers/:provider/validate returns invalid for a bad key
    When I send a POST request to /api/model-providers/openai/validate with invalid customKeys
    Then I receive { valid: false } with an error message

  @integration
  Scenario: POST /api/model-providers/:provider/validate skips validation for complex-auth providers
    When I send a POST request to /api/model-providers/bedrock/validate with customKeys
    Then I receive { valid: true } because bedrock uses complex auth

  @unit
  Scenario: Validate endpoint uses provider-specific auth strategy
    Given provider auth strategies map "anthropic" to x-api-key and "gemini" to query param
    When validation runs for each provider
    Then the correct authentication method is used per provider

  # --- MCP Tool: Get single provider ---

  @integration
  Scenario: platform_get_model_provider returns provider config with available models
    Given the MCP server is connected with a valid LangWatch API key
    When I call platform_get_model_provider with provider "openai"
    Then I receive the provider config including enabled status and available models
    And API keys are masked in the response

  @integration
  Scenario: platform_get_model_provider returns error for unconfigured provider
    Given the MCP server is connected with a valid LangWatch API key
    When I call platform_get_model_provider with provider "nonexistent"
    Then I receive an error indicating the provider is not configured

  # --- MCP Tool: Delete provider ---

  @integration
  Scenario: platform_delete_model_provider removes a provider
    Given the MCP server is connected with a valid LangWatch API key
    When I call platform_delete_model_provider with provider "openai"
    Then I receive confirmation that the provider was removed
    And calling platform_get_model_provider with "openai" returns not found

  # --- MCP Tool: Validate provider ---

  @integration
  Scenario: platform_validate_model_provider validates a provider key
    Given the MCP server is connected with a valid LangWatch API key
    When I call platform_validate_model_provider with provider "openai" and customKeys
    Then I receive whether the key is valid or invalid with an error message

  # --- Feature Map ---

  @unit
  Scenario: feature-map.json lists the REST API endpoint for model providers
    When I read the feature-map.json entry for settings.model-providers
    Then the "api" surface is "/api/model-providers"

  @unit
  Scenario: feature-map.json lists all MCP tools for model providers
    When I read the feature-map.json entry for settings.model-providers
    Then the "platform.mcp" list includes "platform_get_model_provider"
    And the "platform.mcp" list includes "platform_delete_model_provider"
    And the "platform.mcp" list includes "platform_validate_model_provider"
