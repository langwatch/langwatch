@integration @unimplemented
Feature: MCP API Key Tools
  As a coding agent
  I want to manage API keys via the MCP server
  So that I can create, audit, and revoke authentication keys programmatically

  Background:
    Given the MCP server is configured with an org-level API key

  Scenario: Agent lists all API keys
    Given the organization has API keys configured
    When the agent calls platform_list_api_keys
    Then the response contains a list of API keys
    And each key includes id, name, status, creation date, and role bindings
    And active keys show status ACTIVE
    And revoked keys show status REVOKED

  Scenario: Agent lists API keys in an empty organization
    Given the organization has no API keys
    When the agent calls platform_list_api_keys
    Then the response indicates no API keys were found
    And the response suggests using platform_create_api_key

  Scenario: Agent creates a personal API key with role bindings
    When the agent calls platform_create_api_key with:
      | keyType | personal      |
      | name    | Dev Key       |
    And bindings with ADMIN role on PROJECT scope for "proj_abc123"
    Then the response confirms the key was created
    And the response includes the one-time token
    And the response warns to save the token immediately

  Scenario: Agent creates a service API key for specific projects
    When the agent calls platform_create_api_key with:
      | keyType    | service        |
      | name       | CI Pipeline    |
      | projectIds | ["proj_abc123"] |
    Then the response confirms the key was created
    And the response includes the one-time token

  Scenario: Agent creates a service API key with expiration
    When the agent calls platform_create_api_key with:
      | keyType   | service                  |
      | name      | Temp Key                 |
      | expiresAt | 2026-12-31T23:59:59.000Z |
    Then the response confirms the key was created
    And the response includes the one-time token

  Scenario: Agent revokes an API key
    Given an API key exists with id "key_123"
    When the agent calls platform_revoke_api_key with id "key_123"
    Then the response confirms the key was revoked

  Scenario: Agent revokes an already-revoked key
    Given an API key exists with id "key_123" that is already revoked
    When the agent calls platform_revoke_api_key with id "key_123"
    Then the request fails with a 409 Conflict error

  Scenario: Agent calls API key tools without org-level permissions
    Given the API key lacks org-level permissions
    When the agent calls platform_list_api_keys
    Then the request fails with a 403 Forbidden error
    And the error message indicates insufficient permissions
