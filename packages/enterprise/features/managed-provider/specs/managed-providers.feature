Feature: Managed model providers

  @unit
  Scenario: Resolve a managed Bedrock provider
    Given an organization has a valid injected Bedrock configuration
    When the service checks the bedrock provider
    Then it reports the provider as managed

  @unit
  Scenario: Build credentials through both roles
    Given a project resolves to a configured organization
    When LiteLLM parameters are prepared
    Then the proxy role and customer role are assumed in order
    And API key input is replaced by temporary Bedrock credentials

  @unit
  Scenario: Ignore unrelated providers
    Given a model provider is not Bedrock
    When LiteLLM parameters are prepared
    Then the original parameters are returned unchanged
