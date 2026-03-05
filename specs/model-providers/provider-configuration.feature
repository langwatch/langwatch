Feature: Model Provider Configuration
  As a user configuring a model provider
  I want to set up API keys, models, and provider-specific settings
  So that I can use the provider for LangWatch operations

  Background:
    Given I am logged in
    And I have access to a project
    And I have "project:manage" permission

  @visual
  Scenario: OpenAI provider form fields
    When I open the model provider configuration drawer for "openai"
    Then I see the following fields:
      | field           | type       |
      | OPENAI_API_KEY  | text input |
      | OPENAI_BASE_URL | text input |
    And I see a "Custom Models" section
    And I see a "Save" button

  @visual
  Scenario: Azure provider form fields
    When I open the model provider configuration drawer for "azure"
    Then I see a "Use API Gateway" toggle
    And I see an "Extra Headers" section
    And I see a "Custom Models" section
    And I see a "Save" button

  @visual
  Scenario: Azure API Gateway toggle changes visible fields
    When I open the model provider configuration drawer for "azure"
    Then I see a "Use API Gateway" toggle
    And toggling it changes which credential fields are displayed

  @visual
  Scenario: Extra headers section for Azure/Custom providers
    When I open the model provider configuration drawer for "azure"
    Then I see an "Extra Headers" section
    And the section allows adding key-value pairs

  @visual
  Scenario: No extra headers section for standard providers
    When I open the model provider configuration drawer for "openai"
    Then I do not see an "Extra Headers" section

  @integration
  Scenario: Configure API keys with manual input
    Given I open the model provider configuration drawer for "openai"
    When I enter "sk-test123" in the "OPENAI_API_KEY" field
    And I click "Save"
    Then the API key is validated
    And the provider is saved with the API key
    And the drawer closes

  @integration
  Scenario: API key masking when editing existing provider
    Given I have "openai" provider configured with API key "sk-actual123"
    When I open the model provider configuration drawer for "openai"
    Then the "OPENAI_API_KEY" field shows "HAS_KEY••••••••••••••••••••••••"
    And the actual API key value is not displayed

  @integration
  Scenario: Preserve original API key when saving with masked placeholder
    Given I have "openai" provider configured with API key "sk-actual123"
    When I open the model provider configuration drawer for "openai"
    And I see "HAS_KEY••••••••••••••••••••••••" in the API key field
    And I change the base URL to "https://custom.openai.com/v1"
    And I click "Save"
    Then the original API key "sk-actual123" is preserved
    And the base URL is updated to "https://custom.openai.com/v1"

  @integration
  Scenario: Configure API keys from environment variables
    Given I have "openai" provider enabled via environment variable "OPENAI_API_KEY"
    And the provider has no stored customKeys
    When I open the model provider configuration drawer for "openai"
    Then the "OPENAI_API_KEY" field shows "HAS_KEY••••••••••••••••••••••••"
    And the field indicates the key comes from environment variables

  @integration
  Scenario: Add custom model through dialog
    Given I open the model provider configuration drawer for "openai"
    When I click the "+ Add" button in the Custom Models section
    And I select "Add model"
    And I fill in "Model ID" with "gpt-5-custom"
    And I fill in "Display Name" with "GPT-5 Custom"
    And I confirm the dialog
    And I click "Save"
    Then "gpt-5-custom" is added to the provider's custom models
    And the model appears as "openai/gpt-5-custom" in model selectors

  @integration
  Scenario: Configure extra headers for Azure provider
    Given I open the model provider configuration drawer for "azure"
    When I add an extra header with key "api-key" and value "test-value"
    And I click "Save"
    Then the extra header is saved
    And the header is included in API requests

  @integration
  Scenario: Configure extra headers for Custom provider
    Given I open the model provider configuration drawer for "custom"
    When I add an extra header with key "X-Custom-Header" and value "custom-value"
    And I click "Save"
    Then the extra header is saved

  @integration
  Scenario: Toggle API Gateway for Azure provider
    Given I open the model provider configuration drawer for "azure"
    When I toggle "Use API Gateway" to enabled
    Then I see "AZURE_API_GATEWAY_BASE_URL" field
    And I see "AZURE_API_GATEWAY_VERSION" field
    And I do not see "AZURE_OPENAI_API_KEY" field
    And I do not see "AZURE_OPENAI_ENDPOINT" field

  @integration
  Scenario: Toggle API Gateway off for Azure provider
    Given I have Azure provider configured with API Gateway enabled
    When I open the model provider configuration drawer for "azure"
    And I toggle "Use API Gateway" to disabled
    Then I see "AZURE_OPENAI_API_KEY" field
    And I see "AZURE_OPENAI_ENDPOINT" field
    And I do not see "AZURE_API_GATEWAY_BASE_URL" field

  @integration
  Scenario: Configure base URL for provider
    Given I open the model provider configuration drawer for "openai"
    When I enter "https://custom.openai.com/v1" in the "OPENAI_BASE_URL" field
    And I click "Save"
    Then the base URL is saved
    And API requests use the custom base URL

  @integration
  Scenario: Add custom embeddings model through dialog
    Given I open the model provider configuration drawer for "openai"
    When I click the "+ Add" button in the Custom Models section
    And I select "Add embeddings model"
    And I fill in "Model ID" with "text-embedding-custom"
    And I fill in "Display Name" with "Text Embedding Custom"
    And I confirm the dialog
    And I click "Save"
    Then "text-embedding-custom" is added to the provider's custom embeddings models
    And the model appears as "openai/text-embedding-custom" in embedding model selectors

  @integration
  Scenario: Show field validation errors for invalid input
    Given I open the model provider configuration drawer for "openai"
    When I leave the required "OPENAI_API_KEY" field empty
    And I click "Save"
    Then I see a validation error for "OPENAI_API_KEY"
    And the provider is not saved

  @integration
  Scenario: Clear validation errors when user starts typing
    Given I open the model provider configuration drawer for "openai"
    And I see a validation error for "OPENAI_API_KEY"
    When I start typing in the "OPENAI_API_KEY" field
    Then the validation error is cleared
