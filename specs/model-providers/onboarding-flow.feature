Feature: Onboarding Flow
  As a new user setting up LangWatch
  I want to configure a model provider during onboarding
  So that I can start using LangWatch immediately

  Background:
    Given I am a new user going through onboarding
    And I am on the model provider setup step

  @visual
  Scenario: Onboarding model provider form layout
    When I am on the model provider setup step
    Then I see a provider selector
    And I see credential input fields
    And I see a model selector
    And I see a "Save" button

  @visual
  Scenario: Loading state during save
    Given I clicked "Save"
    When the save is in progress
    Then the "Save" button shows a loading indicator
    And the button is disabled

  @integration
  Scenario: Credential input persists during typing
    Given I am configuring the "openai" provider in onboarding
    When I type "s" in the "OPENAI_API_KEY" field
    Then the field shows "s"
    When I type "k" in the field
    Then the field shows "sk"
    When I continue typing "test123"
    Then the field shows "sktest123"
    And my input is not lost or reset

  @integration
  Scenario: Save provider configuration in onboarding
    Given I am configuring the "openai" provider in onboarding
    When I enter "sk-test123" in the "OPENAI_API_KEY" field
    And I select "openai/gpt-4o" as the default model
    And I click "Save"
    Then the provider is saved
    And I am redirected to the next step

  @integration
  Scenario: Redirect to evaluations after saving in evaluations onboarding
    Given I am in the evaluations onboarding flow
    And I am configuring a model provider
    When I complete the provider configuration
    And I click "Save"
    Then I am redirected to "/@project/evaluations"

  @integration
  Scenario: Redirect to prompts after saving in prompts onboarding
    Given I am in the prompts onboarding flow
    And I am configuring a model provider
    When I complete the provider configuration
    And I click "Save"
    Then I am redirected to "/@project/prompts"

  @integration
  Scenario: Form validation works in onboarding context
    Given I am configuring the "openai" provider in onboarding
    When I leave the required "OPENAI_API_KEY" field empty
    And I click "Save"
    Then I see a validation error
    And the provider is not saved
    And I am not redirected

  @integration
  Scenario: Select default model in onboarding
    Given I am configuring the "openai" provider in onboarding
    When I enter valid API credentials
    And I select "openai/gpt-4o" from the model selector
    And I click "Save"
    Then the default model is set to "openai/gpt-4o"
    And the provider is saved

  @integration
  Scenario: Handle OpenAI-specific validation in onboarding
    Given I am configuring the "openai" provider in onboarding
    When I enter only a base URL without an API key
    And the base URL is not the default OpenAI URL
    And I click "Save"
    Then the provider is saved (base URL only is valid for OpenAI)

  @integration
  Scenario: Show OpenAI validation error when using default URL without key
    Given I am configuring the "openai" provider in onboarding
    When I enter the default OpenAI base URL
    And I do not enter an API key
    And I click "Save"
    Then I see an error: "API Key is required when using the default OpenAI base URL"
    And the provider is not saved

  @integration
  Scenario: Clear OpenAI validation error when user starts typing
    Given I am configuring the "openai" provider in onboarding
    And I see an OpenAI validation error
    When I start typing in the "OPENAI_API_KEY" field
    Then the validation error is cleared

  @integration
  Scenario: Show loading state while saving in onboarding
    Given I am configuring a model provider in onboarding
    When I click "Save"
    Then the "Save" button shows a loading state
    And the button is disabled during save

  @integration
  Scenario: Handle save errors gracefully in onboarding
    Given I am configuring a model provider in onboarding
    When I enter invalid configuration
    And I click "Save"
    And the save fails
    Then I see an error message
    And I remain on the onboarding step
    And I can correct the configuration and try again

  # API Key Validation Scenarios

  @integration
  Scenario: Validate API key before saving in onboarding
    Given I am configuring the "openai" provider in onboarding
    When I enter an invalid API key "sk-invalid"
    And I click "Save"
    Then the API key is validated against the provider API
    And I see an API key validation error
    And the provider is not saved

  @integration
  Scenario: Validate env var API key in onboarding
    Given I am configuring a provider that uses environment variables
    And the provider is enabled via env vars with no stored customKeys
    When I click "Save"
    Then the env var API key is validated against the provider API
    And if valid, the provider is saved
    And if invalid, I see a validation error

  @integration
  Scenario: Validate manually-entered API key when env vars are configured
    Given I am configuring a provider that uses environment variables
    And the API key field shows "HAS_KEY••••••••••••••••••••••••"
    When I enter a new API key "sk-invalid-key" replacing the masked value
    And I click "Save"
    Then the new API key is validated
    And I see an API key validation error
    And the provider is not saved

  @integration
  Scenario: Clear API key validation error when user modifies field
    Given I am configuring the "openai" provider in onboarding
    And I see an API key validation error
    When I start typing in the "OPENAI_API_KEY" field
    Then the API key validation error is cleared

  @visual
  # no test
  Scenario: Show API key validation error in onboarding form
    Given an API key validation error occurred
    When I am on the model provider setup step
    Then I see the error message below the credential fields
    And the error is styled as an error message

  @visual
  # no test
  Scenario: Show loading state during API key validation
    Given I clicked "Save"
    When the API key is being validated
    Then the "Save" button shows a loading indicator
    And the button is disabled during validation
