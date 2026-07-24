Feature: Default model resolution for non-registry providers
  As a user with Azure/Bedrock/Vertex as my only provider,
  I want LangWatch features to use my configured deployment model,
  so that I don't see errors about unconfigured providers.

  # Root cause: when Azure is set as default provider, chatOptions can be empty
  # (Azure deployments aren't in the static model registry), so
  # project.defaultModel is set to null. All 18 callsites that do
  # `project.defaultModel ?? DEFAULT_MODEL` then fall back to openai/gpt-5.2.
  #
  # Primary fix: settings UI must include custom models in chatOptions so
  # defaultModel is always set to a valid model for the active provider.
  # This fixes all 18 callsites at once since they all read project.defaultModel.
  #
  # Defense-in-depth: getVercelAIModel resolves from enabled providers when
  # defaultModel is null, instead of hardcoding openai/gpt-5.2.

  # --- Primary fix: settings UI includes custom models in chatOptions ---

  @unit
  Scenario: chatOptions includes custom models for Azure provider
    Given a provider "azure" with customModels ["my-gpt4", "my-gpt35"]
    When chatOptions is computed for the provider
    Then chatOptions contains "azure/my-gpt4" and "azure/my-gpt35"

  @integration
  Scenario: toggling Azure as default sets defaultModel to a custom deployment
    Given a project with Azure OpenAI as the only configured provider
    And the Azure provider has custom models ["my-gpt4-deployment"]
    When the user toggles "Use as default provider" for Azure
    Then project.defaultModel is set to "azure/my-gpt4-deployment"
    And the Default Model selector shows "my-gpt4-deployment"

  # --- Defense-in-depth: server resolves model from enabled providers ---

  @unit
  Scenario: getVercelAIModel resolves from enabled provider when defaultModel is null
    Given a project with defaultModel null
    And provider "azure" is enabled with customModels ["my-gpt4-deployment"]
    When getVercelAIModel is called without a model argument
    Then it uses "azure/my-gpt4-deployment"

  @unit
  Scenario: getVercelAIModel uses DEFAULT_MODEL when its provider is enabled
    Given a project with defaultModel null
    And provider "openai" is enabled
    When getVercelAIModel is called without a model argument
    Then it uses "openai/gpt-5.2"

  @unit
  Scenario: getVercelAIModel throws when no provider can serve any model
    Given a project with defaultModel null
    And no providers are enabled
    When getVercelAIModel is called without a model argument
    Then it throws "No model providers configured for this project"

  # --- Repair: existing projects with stale defaultModel ---

  @unit
  Scenario: getVercelAIModel resolves from provider when defaultModel provider is not configured
    Given a project with defaultModel "openai/gpt-4"
    And provider "openai" is not configured
    And provider "azure" is enabled with customModels ["my-deployment"]
    When getVercelAIModel is called without a model argument
    Then it uses "azure/my-deployment"
