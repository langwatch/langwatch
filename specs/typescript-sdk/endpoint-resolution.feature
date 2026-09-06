Feature: TypeScript SDK endpoint resolution
  As a developer pointing the SDK at LangWatch cloud or a self-hosted instance
  I want the configured endpoint accepted in the shapes people actually write it
  So that a trailing slash or a blank value never turns into an unexplained 404

  Background:
    Given the SDK builds request URLs by appending paths that carry a leading slash

  @unit
  Scenario: A trailing slash on the configured endpoint still reaches the API
    Given a LangWatch client configured with endpoint "https://app.langwatch.ai/"
    When I initialize an experiment
    Then the request goes to "https://app.langwatch.ai/api/experiment/init"
    And the path contains no double slash

  @unit
  Scenario: A trailing slash in the environment endpoint is normalized
    Given LANGWATCH_ENDPOINT is set to "https://app.langwatch.ai/"
    And no endpoint is passed to the client
    When I initialize an experiment
    Then the request goes to "https://app.langwatch.ai/api/experiment/init"

  @unit
  Scenario: Repeated trailing slashes are normalized
    Given a LangWatch client configured with endpoint "http://localhost:5560///"
    When I initialize an experiment
    Then the request goes to "http://localhost:5560/api/experiment/init"

  @unit
  Scenario: A blank environment endpoint falls back to the cloud default
    Given LANGWATCH_ENDPOINT is set to an empty value
    And no endpoint is passed to the client
    When the endpoint is resolved
    Then the resolved endpoint is the cloud default

  @unit
  Scenario: An explicitly configured endpoint wins over the environment
    Given LANGWATCH_ENDPOINT is set to "https://env.langwatch.test/"
    And a LangWatch client configured with endpoint "https://explicit.langwatch.test/"
    When the endpoint is resolved
    Then the resolved endpoint is "https://explicit.langwatch.test"
