Feature: Regenerating the Python SDK's API client keeps the committed client on failure
  As a contributor regenerating the Python SDK's REST client
  I want a run whose generator fails, or writes no client, to leave the committed client alone
  So that a generator that cannot run never deletes the SDK's client

  # langwatch/tasks#509. `make generate/api-client` deleted
  # src/langwatch/generated/langwatch_rest_api_client before the generator
  # ran, so a generator that could not run left about 4,000 tracked files
  # deleted. It now generates into .tmp and replaces the committed client
  # only once a client was produced.
  #
  # Bound by sdks/python/tests/test_generate_api_client.py, which runs the
  # real Makefile target with stub pnpm and uv executables.

  @regression @integration
  Scenario: A generator that fails leaves the committed client in place
    Given the SDK has a committed API client
    When make generate/api-client runs and the generator exits with an error
    Then the target fails
    And the committed API client is unchanged

  @regression @integration
  Scenario: A generator that writes no client leaves the committed client in place
    Given the SDK has a committed API client
    When make generate/api-client runs and the generator exits without writing a client
    Then the target fails and says it is keeping the committed client
    And the committed API client is unchanged

  @integration
  Scenario: A generated client replaces the committed one
    Given the SDK has a committed API client
    When make generate/api-client runs and the generator writes a new client
    Then the target succeeds
    And the committed API client is replaced by the new one
