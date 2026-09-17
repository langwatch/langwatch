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

  Rule: The configured directory is read once, when the process starts

    # Every deployment is a key inside one configured value, so an operator
    # names one setting however it reaches the process. The earlier spelling
    # put the organization in the setting's NAME, which could only be read by
    # walking everything the process was given.

    @unit
    Scenario: Serve several organizations from one configured directory
      Given a managed Bedrock directory naming two organizations
      When the process reads its configuration
      Then each organization resolves to its own Bedrock deployment

    @unit
    Scenario: Run without managed Bedrock when none is configured
      Given no managed Bedrock directory is configured
      When the process reads its configuration
      Then no organization resolves to a Bedrock deployment
      And the process starts normally

    @unit
    Scenario: A configured process serves managed Bedrock
      Given a process configured with a managed Bedrock directory
      When the process starts
      Then an organization in that directory resolves to its Bedrock deployment
      And an organization outside it resolves to none

    @unit
    Scenario: Refuse a malformed directory when the process starts
      Given a managed Bedrock directory that is not valid JSON
      When the process reads its configuration
      Then the process refuses to start and says the configuration is invalid

    @unit
    Scenario: Refuse a directory whose deployment is incomplete
      Given a managed Bedrock directory whose deployment is missing a required field
      When the process reads its configuration
      Then the process refuses to start and says the configuration is invalid
