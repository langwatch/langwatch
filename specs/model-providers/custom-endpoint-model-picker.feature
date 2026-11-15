Feature: A provider on an endpoint of its own is offered only the models it names
  As a project member on an Azure-hosted OpenAI endpoint
  I want the model pickers to list the models I named for that provider
  So that I cannot pick a registry model my endpoint has no deployment for (#9440)

  A provider row can carry a base URL that sends its traffic somewhere other than the
  provider's own API, for example an Azure OpenAI resource configured under "OpenAI".
  That endpoint serves only what it has deployed. When the row also names its own
  models, the registry catalogue is the wrong list for it, and picking a registry-only
  model fails at runtime with a 404. Every picker reads the same rule.

  @unit
  Scenario: An OpenAI endpoint of the operator's own is offered only the models they named
    Given an OpenAI provider whose base URL points at an Azure OpenAI resource
    And the provider names gpt-4.1 and gpt-5-mini as its models
    When a model picker lists the project's chat models
    Then it offers gpt-4.1 and gpt-5-mini
    And it does not offer a registry model the provider did not name

  @unit
  Scenario: An OpenAI row without a base URL keeps the registry models
    Given an OpenAI provider with no base URL
    When a model picker lists the project's chat models
    Then it offers the registry models and the provider's own models

  @unit
  Scenario: A base URL with no models named keeps the registry models
    Given an OpenAI provider with a base URL but no models of its own
    When a model picker lists the project's chat models
    Then it offers the registry models, since nothing says which of them the endpoint serves

  @unit
  Scenario: The row that runs decides, not the union of rows
    Given an OpenAI provider at project scope and another at organization scope
    And only one of them has a base URL and models of its own
    When a model picker lists the project's chat models
    Then the registry models are hidden only when the narrower row is the one with the base URL

  @unit
  Scenario: Embedding models follow the same rule with the embedding models the row names
    Given an OpenAI provider with a base URL and embedding models of its own
    When a model picker lists the project's embedding models
    Then it offers only the embedding models the provider named

  @unit
  Scenario: Other providers keep their registry models
    Given an OpenAI provider on an Azure endpoint beside an Anthropic provider with no base URL
    When a model picker lists the project's chat models
    Then the Anthropic registry models are still offered
