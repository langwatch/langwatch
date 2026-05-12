Feature: Model Provider CLI Commands
  As a developer configuring LLM providers
  I want to manage model providers via CLI
  So that I can set up API keys and defaults without using the UI

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  Scenario: List model providers
    When I run "langwatch model-provider list"
    Then I see a table of providers with name, enabled status, and whether keys are configured

  Scenario: List model providers as JSON
    When I run "langwatch model-provider list -f json"
    Then I see raw JSON with provider configuration details

  Scenario: Configure a model provider
    When I run "langwatch model-provider set openai --enabled true --api-key sk-test123"
    Then the OpenAI provider is configured and I see confirmation

  Scenario: Set a default model for a provider
    When I run "langwatch model-provider set openai --default-model gpt-4o"
    Then the default model is updated and I see confirmation

  Scenario: Run model-provider command without API key
    Given LANGWATCH_API_KEY is not set
    When I run "langwatch model-provider list"
    Then I see an error prompting me to configure my API key
