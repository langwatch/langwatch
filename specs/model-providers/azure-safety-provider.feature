Feature: Azure Safety model provider
  As a user who wants to run Azure Content Safety, Prompt Injection, or Jailbreak evaluators
  I want to configure my own Azure Content Safety subscription
  So that safety evaluations run against my Azure account and I'm billed directly by Microsoft

  Background:
    Given I am logged in
    And I have access to a project
    And I have "project:manage" permission

  @integration
  Scenario: Azure Safety appears in the Add Model Provider list
    When I open the model providers settings page
    And I click "Add Model Provider"
    Then I see "Azure Safety" in the provider list
    And "Azure Safety" is described as "Azure Content Safety for content moderation, prompt injection, and jailbreak detection"

  @integration
  Scenario: Configure Azure Safety saves endpoint and subscription key
    Given I open the model provider configuration drawer for "azure_safety"
    When I enter "https://my-account.cognitiveservices.azure.com/" in the "AZURE_CONTENT_SAFETY_ENDPOINT" field
    And I enter "my-subscription-key" in the "AZURE_CONTENT_SAFETY_KEY" field
    And I click "Save"
    Then the Azure Safety provider is saved for the project
    And the drawer closes

  @integration
  Scenario: Azure Safety form only shows credentials and extra headers
    When I open the model provider configuration drawer for "azure_safety"
    Then I see the following fields:
      | field                            | type         |
      | AZURE_CONTENT_SAFETY_ENDPOINT    | text input   |
      | AZURE_CONTENT_SAFETY_KEY         | password     |
    And I see an "Extra Headers" section
    And I do not see a "Custom Models" section
    And I do not see a "Default Model" section
    And I do not see a "Use API Gateway" toggle

  @integration
  Scenario: Azure Safety validates endpoint is a URL
    Given I open the model provider configuration drawer for "azure_safety"
    When I enter "not-a-url" in the "AZURE_CONTENT_SAFETY_ENDPOINT" field
    And I enter "key" in the "AZURE_CONTENT_SAFETY_KEY" field
    And I click "Save"
    Then I see a validation error for "AZURE_CONTENT_SAFETY_ENDPOINT"
    And the provider is not saved

  @integration
  Scenario: Azure Safety validates subscription key is non-empty
    Given I open the model provider configuration drawer for "azure_safety"
    When I enter "https://my-account.cognitiveservices.azure.com/" in the "AZURE_CONTENT_SAFETY_ENDPOINT" field
    And I leave the "AZURE_CONTENT_SAFETY_KEY" field empty
    And I click "Save"
    Then I see a validation error for "AZURE_CONTENT_SAFETY_KEY"
    And the provider is not saved

  @integration
  Scenario: Subscription key is masked when editing existing Azure Safety provider
    Given I have "azure_safety" provider configured with key "real-subscription-key"
    When I open the model provider configuration drawer for "azure_safety"
    Then the "AZURE_CONTENT_SAFETY_KEY" field shows "HAS_KEY••••••••••••••••••••••••"
    And the actual subscription key value is not displayed

  @integration
  Scenario: Preserve original subscription key when saving with masked placeholder
    Given I have "azure_safety" provider configured with key "real-subscription-key"
    When I open the model provider configuration drawer for "azure_safety"
    And I see "HAS_KEY••••••••••••••••••••••••" in the subscription key field
    And I change the endpoint to "https://new-account.cognitiveservices.azure.com/"
    And I click "Save"
    Then the original subscription key "real-subscription-key" is preserved
    And the endpoint is updated to "https://new-account.cognitiveservices.azure.com/"

  @integration
  Scenario: Disable Azure Safety provider
    Given I have "azure_safety" provider enabled with valid credentials
    When I open the model provider configuration drawer for "azure_safety"
    And I toggle the provider to disabled
    And I click "Save"
    Then the Azure Safety provider is disabled for the project
    And the stored credentials are preserved
