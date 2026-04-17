Feature: CLI error handling
  As an engineer or code assistant using the LangWatch CLI
  I want errors from the API to be surfaced clearly and actionably
  So that I can understand and fix problems without having to read server logs

  Background:
    Given I have a valid API key configured
    And the LangWatch API is reachable

  @integration
  Scenario: Sync surfaces a specific conflict message when a handle is already in use by an active prompt
    Given an active prompt with handle "billing-bot" exists on the server
    When I run `langwatch prompt sync` with a local prompt file using handle "billing-bot" and a different prompt id
    Then the CLI output includes the phrase "handle already exists"
    And the CLI output does not include the phrase "Internal server error"
    And the CLI exits with status 1

  @integration
  Scenario: API errors surface a meaningful message, not the bare "Internal server error" label
    Given the API responds with status 500 and body '{"error":"DatabaseError","message":"connection refused"}'
    When I run any CLI command that calls that endpoint
    Then the CLI output includes "connection refused"
    And the CLI exits with status 1

  @integration
  Scenario: Error bodies with no parseable message fall back to the raw JSON payload
    Given the API responds with status 500 and body '{"code":"UNEXPECTED","details":{"traceId":"abc"}}'
    When I run any CLI command that calls that endpoint
    Then the CLI output includes "UNEXPECTED"
    And the CLI output includes "traceId"
    And the CLI exits with status 1

  @integration
  Scenario: Invalid API key returns a clear authentication error, not a generic one
    Given I configure an invalid API key
    When I run any CLI command that calls the API
    Then the CLI output clearly mentions "API key" or "unauthorized"
    And the CLI exits with status 1

  @integration
  Scenario: Network errors surface the underlying cause
    Given the API host is unreachable
    When I run any CLI command that calls the API
    Then the CLI output includes the word "network" or "ECONNREFUSED" or "unreachable"
    And the CLI exits with status 1

  @integration
  Scenario Outline: Common error conditions map to actionable messages for every CLI command
    Given the API responds with status <status> for command "<command>"
    When I run "<command>"
    Then the CLI output includes an identifier for the resource
    And the CLI output does not include the bare phrase "Internal server error" unless the server genuinely gave no other signal
    And the CLI exits with status 1

    Examples:
      | command                        | status |
      | langwatch prompt sync          |    500 |
      | langwatch agent create foo     |    409 |
      | langwatch dataset get missing  |    404 |
      | langwatch monitor create m     |    422 |
      | langwatch secret create FOO    |    409 |
