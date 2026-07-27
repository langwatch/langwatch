Feature: Credential Validation
  As a user configuring model providers
  I want my API keys to be validated
  So that I know they work before saving

  # Most scenarios describe the model provider configuration drawer UI flow
  # (open drawer → enter key → click Save → see validation error or success).
  # Need a JSDOM render of `ModelProviderForm` + integration test against the
  # `validateProviderApiKey` server action. Service-level masking/preservation
  # logic is covered by `modelProvider.service.unit.test.ts` (mergeCustomKeys).
  # Aspirational pending the form harness.

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

  @integration @unimplemented
  Scenario: Validate API key against provider API
    Given I open the model provider configuration drawer for "openai"
    When I enter "sk-test123" in the "OPENAI_API_KEY" field
    And I click "Save"
    Then the API key is validated against the OpenAI API
    And if valid, the provider is saved
    And if invalid, I see a validation error

  @integration @unimplemented
  Scenario: Validate stored API key when custom URL is provided
    Given I have "openai" provider configured with API key "sk-actual123"
    When I open the model provider configuration drawer for "openai"
    And I see "HAS_KEY••••••••••••••••••••••••" in the API key field
    And I enter "https://custom.openai.com/v1" in the "OPENAI_BASE_URL" field
    And I click "Save"
    Then the stored API key is validated against the custom base URL
    And if valid, the provider is saved
    And if invalid, I see a validation error

  @integration @unimplemented
  Scenario: Show masked placeholder for env var providers
    Given I have "openai" provider enabled via environment variable
    And the provider has no stored customKeys
    When I open the model provider configuration drawer for "openai"
    Then the "OPENAI_API_KEY" field shows "HAS_KEY••••••••••••••••••••••••"
    And the field appears as if it has a value

  @integration @unimplemented
  Scenario: Always validate env var API key on save
    Given I have "openai" provider enabled via environment variable
    When I open the model provider configuration drawer for "openai"
    And I see "HAS_KEY••••••••••••••••••••••••" in the API key field
    And I click "Save" without making any changes
    Then the env var API key is validated against the OpenAI API
    And if valid, the provider is saved
    And if invalid, I see a validation error

  @integration @unimplemented
  Scenario: Always validate stored API key on save
    Given I have "openai" provider configured with API key "sk-actual123"
    When I open the model provider configuration drawer for "openai"
    And I see "HAS_KEY••••••••••••••••••••••••" in the API key field
    And I click "Save" without making any changes
    Then the stored API key is validated against the OpenAI API
    And if valid, the provider is saved
    And if invalid, I see a validation error

  @integration @unimplemented
  Scenario: Show error when no API key is available
    Given "openai" provider has no stored API key and no env var set
    When I try to save the provider
    Then I see an error: "No API key found for openai. Please enter an API key."
    And the provider is not saved

  @integration @unimplemented
  Scenario: Show field-level validation errors for invalid schema
    Given I open the model provider configuration drawer for "openai"
    When I enter an invalid value in a required field
    And I click "Save"
    Then I see a Zod schema validation error
    And the error is shown for the specific field
    And the provider is not saved

  @integration @unimplemented
  Scenario: Show API key validation error
    Given I open the model provider configuration drawer for "openai"
    When I enter an invalid API key "sk-invalid"
    And I click "Save"
    Then I see an API key validation error
    And the error message explains the API key is invalid
    And the provider is not saved

  @integration @unimplemented
  Scenario: Clear validation error when user modifies field
    Given I open the model provider configuration drawer for "openai"
    And I see an API key validation error
    When I start typing in the "OPENAI_API_KEY" field
    Then the validation error is cleared

  @integration @unimplemented
  Scenario: Skip validation for providers with complex auth
    Given I open the model provider configuration drawer for "bedrock"
    When I enter credentials
    And I click "Save"
    Then validation is skipped (Bedrock uses AWS credentials)
    And the provider is saved

  @integration @unimplemented
  Scenario: Skip validation for Vertex AI provider
    Given I open the model provider configuration drawer for "vertex_ai"
    When I enter credentials
    And I click "Save"
    Then validation is skipped (Vertex AI uses gcloud credentials)
    And the provider is saved

  @integration @unimplemented
  Scenario: Validate with custom base URL
    Given I open the model provider configuration drawer for "openai"
    When I enter "sk-test123" in the "OPENAI_API_KEY" field
    And I enter "https://custom.openai.com/v1" in the "OPENAI_BASE_URL" field
    And I click "Save"
    Then the API key is validated against the custom base URL
    And if valid, the provider is saved with the custom base URL

  @integration @unimplemented
  Scenario: Reject invalid URL format in base URL field
    Given I open the model provider configuration drawer for "openai"
    When I enter a valid API key
    And I enter "not-a-valid-url" in the "OPENAI_BASE_URL" field
    And I click "Save"
    Then I see a validation error with URL format example
    And the provider is not saved

  @integration @unimplemented
  Scenario: Validate env var API key against custom URL
    Given I have "openai" provider enabled via environment variable
    When I open the model provider configuration drawer for "openai"
    And I see "HAS_KEY••••••••••••••••••••••••" in the API key field
    And I enter "https://custom.openai.com/v1" in the "OPENAI_BASE_URL" field
    And I click "Save"
    Then the env var API key is validated against the custom base URL
    And if valid, the provider is saved
    And if invalid, I see a validation error

  @integration @unimplemented
  Scenario: Reject invalid URL when provider uses env vars
    Given I have "openai" provider enabled via environment variable
    When I open the model provider configuration drawer for "openai"
    And I enter "not-a-valid-url" in the "OPENAI_BASE_URL" field
    And I click "Save"
    Then I see a validation error with URL format example
    And the provider is not saved

  @integration @unimplemented
  Scenario: Validate manually-entered API key when provider uses env vars
    Given I have "openai" provider enabled via environment variable
    When I open the model provider configuration drawer for "openai"
    And I see "HAS_KEY••••••••••••••••••••••••" in the API key field
    And I enter a new API key "sk-invalid-key"
    And I click "Save"
    Then the new API key is validated against the provider API
    And I see an API key validation error
    And the provider is not saved

  @integration @unimplemented
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

  @unit
  Scenario: ElevenLabs keys validate with the xi-api-key header
    Given I am validating an ElevenLabs API key
    When I call validateProviderApiKey with an ELEVENLABS_API_KEY
    Then the models endpoint at api.elevenlabs.io is probed with the xi-api-key header
    And a 200 marks the key valid
    And a 401 reports an invalid API key, not a network problem

  @unit
  Scenario: Providers with no known validation endpoint skip validation
    Given a registered provider that has no default validation base URL and no custom endpoint
    When I call validateProviderApiKey for it
    Then validation is skipped instead of probing a relative URL
    And no misleading network-connection error is shown

  # A rejected key is a dead end for the customer: the drawer refuses to save
  # until the probe passes. So the message has to name the real cause, or the
  # customer regenerates a working key over and over and gets nowhere.

  @unit
  Scenario: Gemini reports a disabled Generative Language API, not a bad key
    Given a Gemini key created in the Google Cloud console
    And the Generative Language API is not enabled on that project
    When I call validateProviderApiKey for it
    Then I am told to enable the Generative Language API
    And I am not told the API key is invalid

  @unit
  Scenario: Gemini reports a key restricted away from the API, not a bad key
    Given a Gemini key whose API restrictions exclude the Generative Language API
    When I call validateProviderApiKey for it
    Then I am told the key's restrictions exclude the API
    And I am not told the API key is invalid

  @unit
  Scenario: Gemini reports a key restricted to other callers, not a bad key
    Given a Gemini key carrying a referrer, IP, or app restriction
    When I call validateProviderApiKey for it
    Then I am told the key's restrictions block the request
    And I am not told the API key is invalid

  @unit
  Scenario: Gemini reports a genuinely invalid key as invalid
    Given a Gemini key that Google reports as API_KEY_INVALID
    When I call validateProviderApiKey for it
    Then I am told the API key is invalid

  @unit
  Scenario: A refusal carries the provider's own explanation
    Given a provider rejects the key with an explanation in the response body
    When I call validateProviderApiKey for it
    Then the explanation is included in the error I see

  @unit
  Scenario: A refusal with no readable explanation falls back to the generic message
    Given a provider rejects the key with a body that cannot be read or parsed
    When I call validateProviderApiKey for it
    Then I am told the API key is invalid

  @unit
  Scenario: A refusal never repeats the submitted API key
    Given a provider echoes the submitted API key back in its explanation
    When I call validateProviderApiKey for it
    Then the key is hidden from the error I see

  # The probe runs from our servers. A key restricted to the customer's own
  # network, a provider outage, or a key that has not finished propagating all
  # look exactly like a bad key, so a refusal cannot be the end of the road.

  @integration
  Scenario: A refused key can still be saved
    Given the provider refuses the API key I entered
    When I click "Save"
    Then the provider is not saved
    And the button offers to save anyway

  @integration
  Scenario: Saving anyway does not probe the provider again
    Given the provider refused the API key I entered
    When I click "Save anyway"
    Then the provider is saved
    And the provider is not probed a second time

  @integration
  Scenario: Correcting a refused key probes it again
    Given the provider refused the API key I entered
    When I change the API key
    Then the button offers to save
    And saving probes the corrected key

  @unit
  Scenario: A provider server error is not reported as a bad key
    Given a provider returns a server error
    When I call validateProviderApiKey for it
    Then I am told validation failed with the status code
    And I am not told the API key is invalid
