Feature: Credential Validation
  As a user configuring model providers
  I want my API keys to be validated
  So that I know they work before saving

  Background:
    Given I am logged in
    And I have access to a project
    And I have "project:manage" permission

  @visual
  Scenario: Masked API key display format
    Given a provider has a configured API key
    When I open the provider configuration drawer
    Then the API key field shows "HAS_KEY" followed by masked characters
    And the actual key value is not visible

  @visual
  Scenario: Validation error display
    Given a validation error occurred
    When I am on the provider configuration drawer
    Then I see an error message near the invalid field
    And the field is visually highlighted

  @integration
  Scenario: Validate API key against provider API
    Given I open the model provider configuration drawer for "openai"
    When I enter "sk-test123" in the "OPENAI_API_KEY" field
    And I click "Save"
    Then the API key is validated against the OpenAI API
    And if valid, the provider is saved
    And if invalid, I see a validation error

  @integration
  Scenario: Validate stored API key when custom URL is provided
    Given I have "openai" provider configured with API key "sk-actual123"
    When I open the model provider configuration drawer for "openai"
    And I see "HAS_KEY••••••••••••••••••••••••" in the API key field
    And I enter "https://custom.openai.com/v1" in the "OPENAI_BASE_URL" field
    And I click "Save"
    Then the stored API key is validated against the custom base URL
    And if valid, the provider is saved
    And if invalid, I see a validation error

  @integration
  Scenario: Show masked placeholder for env var providers
    Given I have "openai" provider enabled via environment variable
    And the provider has no stored customKeys
    When I open the model provider configuration drawer for "openai"
    Then the "OPENAI_API_KEY" field shows "HAS_KEY••••••••••••••••••••••••"
    And the field appears as if it has a value

  @integration
  Scenario: Always validate env var API key on save
    Given I have "openai" provider enabled via environment variable
    When I open the model provider configuration drawer for "openai"
    And I see "HAS_KEY••••••••••••••••••••••••" in the API key field
    And I click "Save" without making any changes
    Then the env var API key is validated against the OpenAI API
    And if valid, the provider is saved
    And if invalid, I see a validation error

  @integration
  Scenario: Always validate stored API key on save
    Given I have "openai" provider configured with API key "sk-actual123"
    When I open the model provider configuration drawer for "openai"
    And I see "HAS_KEY••••••••••••••••••••••••" in the API key field
    And I click "Save" without making any changes
    Then the stored API key is validated against the OpenAI API
    And if valid, the provider is saved
    And if invalid, I see a validation error

  @integration
  Scenario: Show error when no API key is available
    Given "openai" provider has no stored API key and no env var set
    When I try to save the provider
    Then I see an error: "No API key found for openai. Please enter an API key."
    And the provider is not saved

  @integration
  Scenario: Show field-level validation errors for invalid schema
    Given I open the model provider configuration drawer for "openai"
    When I enter an invalid value in a required field
    And I click "Save"
    Then I see a Zod schema validation error
    And the error is shown for the specific field
    And the provider is not saved

  @integration
  Scenario: Show API key validation error
    Given I open the model provider configuration drawer for "openai"
    When I enter an invalid API key "sk-invalid"
    And I click "Save"
    Then I see an API key validation error
    And the error message explains the API key is invalid
    And the provider is not saved

  @integration
  Scenario: Clear validation error when user modifies field
    Given I open the model provider configuration drawer for "openai"
    And I see an API key validation error
    When I start typing in the "OPENAI_API_KEY" field
    Then the validation error is cleared

  @integration
  Scenario: Skip validation for providers with complex auth
    Given I open the model provider configuration drawer for "bedrock"
    When I enter credentials
    And I click "Save"
    Then validation is skipped (Bedrock uses AWS credentials)
    And the provider is saved

  @integration
  Scenario: Skip validation for Vertex AI provider
    Given I open the model provider configuration drawer for "vertex_ai"
    When I enter credentials
    And I click "Save"
    Then validation is skipped (Vertex AI uses gcloud credentials)
    And the provider is saved

  @integration
  Scenario: Validate with custom base URL
    Given I open the model provider configuration drawer for "openai"
    When I enter "sk-test123" in the "OPENAI_API_KEY" field
    And I enter "https://custom.openai.com/v1" in the "OPENAI_BASE_URL" field
    And I click "Save"
    Then the API key is validated against the custom base URL
    And if valid, the provider is saved with the custom base URL

  @integration
  Scenario: Reject invalid URL format in base URL field
    Given I open the model provider configuration drawer for "openai"
    When I enter a valid API key
    And I enter "not-a-valid-url" in the "OPENAI_BASE_URL" field
    And I click "Save"
    Then I see a validation error with URL format example
    And the provider is not saved

  @integration
  Scenario: Validate env var API key against custom URL
    Given I have "openai" provider enabled via environment variable
    When I open the model provider configuration drawer for "openai"
    And I see "HAS_KEY••••••••••••••••••••••••" in the API key field
    And I enter "https://custom.openai.com/v1" in the "OPENAI_BASE_URL" field
    And I click "Save"
    Then the env var API key is validated against the custom base URL
    And if valid, the provider is saved
    And if invalid, I see a validation error

  @integration
  Scenario: Reject invalid URL when provider uses env vars
    Given I have "openai" provider enabled via environment variable
    When I open the model provider configuration drawer for "openai"
    And I enter "not-a-valid-url" in the "OPENAI_BASE_URL" field
    And I click "Save"
    Then I see a validation error with URL format example
    And the provider is not saved

  @integration
  Scenario: Validate manually-entered API key when provider uses env vars
    Given I have "openai" provider enabled via environment variable
    When I open the model provider configuration drawer for "openai"
    And I see "HAS_KEY••••••••••••••••••••••••" in the API key field
    And I enter a new API key "sk-invalid-key"
    And I click "Save"
    Then the new API key is validated against the provider API
    And I see an API key validation error
    And the provider is not saved

  @integration
  Scenario: Validate Anthropic with custom base URL
    Given I open the model provider configuration drawer for "anthropic"
    When I enter a valid API key
    And I enter "https://custom-anthropic.example.com" in the "ANTHROPIC_BASE_URL" field
    And I click "Save"
    Then the API key is validated against the custom base URL
    And if valid, the provider is saved with the custom base URL

  @unit
  Scenario: Skip validation when no API key provided
    Given I am validating API keys
    When I call validateProviderApiKey with empty API key
    Then validation is skipped
    And the result is valid (schema validation handles required fields)

  @unit
  Scenario: Skip validation for masked placeholder in validation function
    Given I am validating API keys
    When I call validateProviderApiKey with "HAS_KEY••••••••••••••••••••••••"
    Then validation is skipped
    And the result is valid
