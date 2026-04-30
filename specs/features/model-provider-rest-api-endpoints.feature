Feature: Model Provider REST API - missing endpoints
  As an API consumer (SDK, CLI, or external integration)
  I want to get a single provider, delete a provider, and validate API keys via REST
  So that I have full CRUD and validation capabilities without relying on tRPC

  Background:
    Given I am authenticated with a valid project API key
    And the project has an "openai" provider configured with a stored API key

  # --- GET /api/model-providers/:provider ---

  @integration
  Scenario: Retrieve a configured provider
    When I send GET /api/model-providers/openai
    Then I receive a 200 response with the provider object
    And the response body matches the apiResponseModelProviderSchema shape
    And API keys in the response are masked with the placeholder
    And non-secret fields like endpoint URLs are preserved unmasked

  @integration
  Scenario: Retrieve a provider with no DB record falls back to registry default
    When I send GET /api/model-providers/anthropic
    Then I receive a 200 response with the default provider config from the registry
    And the "enabled" field reflects whether the environment key is present

  @integration
  Scenario: Retrieve an unknown provider key
    When I send GET /api/model-providers/nonexistent-provider
    Then I receive a 404 response

  # --- DELETE /api/model-providers/:provider ---

  @integration
  Scenario: Remove a configured provider
    When I send DELETE /api/model-providers/openai
    Then I receive a 204 response with no body
    And GET /api/model-providers/openai no longer has stored customizations

  @integration
  Scenario: Remove a valid provider with no DB record
    When I send DELETE /api/model-providers/anthropic
    Then I receive a 204 response with no body

  @integration
  Scenario: Remove an unknown provider key
    When I send DELETE /api/model-providers/nonexistent-provider
    Then I receive a 404 response

  # --- POST /api/model-providers/:provider/validate ---

  @integration
  Scenario: Validate a correct API key
    When I send POST /api/model-providers/openai/validate with valid customKeys
    Then I receive a 200 response with { "valid": true }

  @integration
  Scenario: Validate an incorrect API key
    When I send POST /api/model-providers/openai/validate with invalid customKeys
    Then I receive a 200 response with { "valid": false, "error": "..." }

  @integration
  Scenario: Validate a provider that uses complex auth
    When I send POST /api/model-providers/azure/validate with customKeys
    Then I receive a 200 response with { "valid": true }

  @integration
  Scenario: Validate with the masked key placeholder
    When I send POST /api/model-providers/openai/validate with the masked placeholder as key
    Then I receive a 200 response with { "valid": true }

  # --- Authentication (single scenario covers shared middleware) ---

  @integration
  Scenario: Unauthenticated requests are rejected
    Given I have no authentication credentials
    When I send GET /api/model-providers/openai
    Then I receive a 401 response
