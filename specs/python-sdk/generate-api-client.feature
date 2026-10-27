Feature: Regenerating the Python SDK's API client keeps the committed client on failure
  As a contributor regenerating the Python SDK's REST client
  I want a run whose generator fails, or writes no client, to leave the committed client alone
  So that a generator that cannot run never deletes the SDK's client

  # langwatch/tasks#509. Bound by sdks/python/tests/test_generate_api_client.py,
  # which runs the real Makefile target with stub pnpm and uv executables.

  @regression @unit
  Scenario: A generator that fails leaves the committed client in place
    Given the SDK has a committed API client
    When make generate/api-client runs and the generator exits with an error
    Then the target fails
    And the committed API client is unchanged

  @regression @unit
  Scenario: A generator that writes no client leaves the committed client in place
    Given the SDK has a committed API client
    When make generate/api-client runs and the generator exits without writing a client
    Then the target fails and says it is keeping the committed client
    And the committed API client is unchanged

  @unit
  Scenario: A generated client replaces the committed one
    Given the SDK has a committed API client
    When make generate/api-client runs and the generator writes a new client
    Then the target succeeds
    And the committed API client is replaced by the new one

  @regression @unit
  Scenario: A stale client left in .tmp by an earlier run is not installed
    Given the SDK has a committed API client
    And an earlier aborted run left a generated client in .tmp
    When make generate/api-client runs and the generator exits without writing a client
    Then the target fails
    And the committed API client is unchanged
