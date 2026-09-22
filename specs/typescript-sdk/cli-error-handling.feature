Feature: CLI error handling
  As an engineer or code assistant using the LangWatch CLI
  I want errors from the API to be surfaced clearly and actionably
  So that I can understand and fix problems without having to read server logs

  Background:
    Given I have a valid API key configured
    And the LangWatch API is reachable

  @integration @unimplemented
  Scenario: Sync surfaces a specific conflict message when a handle is already in use by an active prompt
    Given an active prompt with handle "billing-bot" exists on the server
    When I run `langwatch prompt sync` with a local prompt file using handle "billing-bot" and a different prompt id
    Then the CLI output includes the phrase "handle already exists"
    And the CLI output does not include the phrase "Internal server error"
    And the CLI exits with status 1

  @integration @unimplemented
  Scenario: API errors surface a meaningful message, not the bare "Internal server error" label
    Given the API responds with status 500 and body '{"error":"DatabaseError","message":"connection refused"}'
    When I run any CLI command that calls that endpoint
    Then the CLI output includes "connection refused"
    And the CLI exits with status 1

  @integration @unimplemented
  Scenario: Error bodies with no parseable message fall back to the raw JSON payload
    Given the API responds with status 500 and body '{"code":"UNEXPECTED","details":{"traceId":"abc"}}'
    When I run any CLI command that calls that endpoint
    Then the CLI output includes "UNEXPECTED"
    And the CLI output includes "traceId"
    And the CLI exits with status 1

  @integration @unimplemented
  Scenario: Invalid API key returns a clear authentication error, not a generic one
    Given I configure an invalid API key
    When I run any CLI command that calls the API
    Then the CLI output clearly mentions "API key" or "unauthorized"
    And the CLI exits with status 1

  @integration @unimplemented
  Scenario: Network errors surface the underlying cause
    Given the API host is unreachable
    When I run any CLI command that calls the API
    Then the CLI output includes the word "network" or "ECONNREFUSED" or "unreachable"
    And the CLI exits with status 1

  # A missing dataset used to be reported as a network error at status 0,
  # with "Check your network connection" as the advice for a wrong slug.
  @unit
  Scenario: A missing dataset is reported as not found, not as a network error
    Given a dataset command is given a slug that does not exist
    When the command reports its failure
    Then the error document carries the code "not_found" and status 404
    And the suggestions speak of the slug, not of the network

  @unit
  Scenario: A dataset plan limit is reported with its own code
    Given a dataset command runs into the plan limit
    When the command reports its failure
    Then the error document carries the code "plan_limit_reached" and status 403
    And the limit type and the usage stand in the meta

  @integration @unimplemented
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

  Rule: a fault in the CLI's own code is not reported as a network failure

    A failure with no HTTP status was read as `network_error`, which is right
    for a request that never landed and wrong for a crash while rendering a
    response that already arrived. `langwatch chart schema` crashed on a
    payload shape it did not expect and the user was told to check their
    network connection, for a bug they could not fix.

    @unit
    Scenario: a TypeError with no status is an internal error, not a network one
      Given a TypeError is thrown while a command renders a response
      When the failure is read into the CLI's error structure
      Then the code is internal_error
      And it is not network_error
      And it is still marked as a failure the platform did not name

    @unit
    Scenario: a request that never landed is still a network failure
      Given a plain Error is thrown with no HTTP status
      When the failure is read into the CLI's error structure
      Then the code is network_error

    @unit
    Scenario: a TLS failure is a network failure, not a code the platform chose
      Given fetch fails with an expired certificate, which carries no errno
        or syscall the way a refused socket does
      When the failure is read into the CLI's error structure
      Then the code is network_error
      And the certificate code is not presented as the platform's own

    @unit
    Scenario: chart schema names a payload it does not recognise
      Given the analytics schema comes back without its list of views
      When the user runs `langwatch chart schema`
      Then the command exits non-zero with a validation error
      And the message says to update the CLI
      And no TypeError reaches the user
