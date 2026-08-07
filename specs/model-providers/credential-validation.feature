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

  # A refused key holds the save back on the first attempt, so the message has
  # to name the real cause — otherwise the customer regenerates a working key
  # over and over. Saving anyway is available once the reason has been read.

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

  # A provider's own sentence is never shown. It is the text that quotes the
  # request back, and a rejected-credential body is where the credential
  # itself turns up. We say what happened in our own words instead.

  @unit
  Scenario: A refusal is explained in our own words, not the provider's
    Given a provider rejects the key with an explanation in the response body
    When I call validateProviderApiKey for it
    Then I am told the key was refused
    And the provider's own sentence is not part of what I am told

  @unit
  Scenario: A refusal with no readable explanation says the same thing
    Given a provider rejects the key with a body that cannot be read or parsed
    When I call validateProviderApiKey for it
    Then I am told the key was refused

  @unit
  Scenario: A refusal never repeats the submitted API key
    Given a provider echoes the submitted API key back in its explanation
    When I call validateProviderApiKey for it
    Then the key appears nowhere in what I am told

  # tRPC sends queries as GET with their input in the URL, and the input here
  # is the customer's API key. Mutations are audit-logged with their input, so
  # the two have to move together or the key just changes hiding place.

  @unit
  Scenario: A credential is never persisted to the audit trail
    Given a recorded action carrying provider credentials
    When it is written to the audit trail
    Then the credential values are not stored
    And which credentials were set is still recorded

  @unit
  Scenario: A credential typed as a header is never persisted either
    Given a recorded action carrying an authorization header
    When it is written to the audit trail
    Then the header value is not stored
    And the header name is still recorded


  @unit
  Scenario: The API key is never sent in a URL
    Given a key to check
    When validation runs
    Then the key travels in the request body
    And the key is never placed in a URL

  # A credential is not tied to one URL. Google issues Gemini keys from AI
  # Studio, the Cloud console and Agent Platform, and the same key answers on
  # a query parameter, on a header, and on the OpenAI-compatible surface.
  # Probing one shape reported our own narrow guess as the customer's problem.

  @unit
  Scenario: A key any supported auth shape accepts is valid
    Given the first auth shapes refuse the key
    And a later auth shape accepts it
    When I call validateProviderApiKey for it
    Then the key is valid

  @unit
  Scenario: Every auth shape the provider supports is tried
    Given a Gemini key that every shape refuses
    When I call validateProviderApiKey for it
    Then the key is tried as a query parameter
    And the key is tried as a header
    And the key is tried against the OpenAI-compatible surface

  @unit
  Scenario: Probing stops at the first shape that answers
    Given the first auth shape accepts the key
    When I call validateProviderApiKey for it
    Then the key is valid without asking the remaining shapes

  @unit
  Scenario: A provider with one documented auth shape is probed once
    Given an OpenAI key that is refused
    When I call validateProviderApiKey for it
    Then only the documented shape is tried

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
  Scenario: Saving anyway keeps the credential I entered
    Given the provider refused the API key I entered
    When I click "Save anyway"
    Then the provider is saved with that key
    And I am not interrupted by the refusal again

  @integration
  Scenario: Correcting a refused key has it checked again
    Given the provider refused the API key I entered
    When I change the API key
    Then the button offers to save
    And the corrected key is accepted on its own merits

  @unit
  Scenario: A provider server error is not reported as a bad key
    Given a provider returns a server error
    When I call validateProviderApiKey for it
    Then I am told validation failed with the status code
    And I am not told the API key is invalid

  # A provider that never answered is the absence of a verdict, not a verdict.
  # It is raised rather than returned — which means it crosses the wire as a
  # handled error, where free text is replaced by a stable code. The sentence
  # has to travel on the channel that survives that, or the customer reads the
  # code itself at the exact moment they are least able to decode it.

  @unit
  Scenario: An unreachable provider is explained, not named by its code
    Given the provider never answers the probe
    When validation runs
    Then I am told the provider could not be reached
    And I am told what to check
    And I am not shown an internal error code

  @integration
  Scenario: An unreachable provider is not recorded as our own failure
    Given the base URL I entered never answers
    When validation runs
    Then the failure is attributed to the provider

  # ──────────────────────────────────────────────────────────────────────
  # Testing a credential that is already saved.
  #
  # Everything above happens while a credential is being entered. This part
  # is about the one already stored: a customer who has finished configuring
  # a provider wants to know they filled it in correctly, without editing a
  # key the form deliberately never shows them.
  #
  # The whole section rests on one rule. A check that cannot run is not a
  # check that passed. Six of the sixteen providers cannot be probed at all,
  # and for those the honest answer is that we did not look — reporting them
  # as working would be worse than offering nothing, because the customer
  # would stop looking too.
  # ──────────────────────────────────────────────────────────────────────

  @unit
  Scenario: Testing a saved provider uses the credential already stored
    Given I have a configured provider
    When I test the connection from the provider list
    Then the stored credential is used
    And I am not asked to enter the key again

  @unit
  Scenario: A working credential says so
    Given I have a configured provider whose credential the provider accepts
    When I test the connection
    Then I am told the connection works

  @unit
  Scenario: A refused credential is explained in our own words
    Given I have a configured provider whose credential the provider refuses
    When I test the connection
    Then I am told the credential was refused
    And the provider's own sentence is not part of what I am told

  @unit
  Scenario: A provider we cannot check says so instead of reporting success
    Given I have a configured provider that cannot be checked automatically
    When I test the connection
    Then I am told the connection could not be checked
    And I am not told the connection works

  @unit
  Scenario: Testing an organization-scoped provider reaches its credential
    Given I have a provider configured at the organization scope
    When I test the connection from the provider list
    Then the stored credential is found
    And I am not told the provider has no credential

  @unit
  Scenario: A test never accepts an endpoint from the caller
    Given I have a configured provider
    When I test the connection
    Then the endpoint already saved on the provider is used
    And an endpoint supplied with the request is refused

  @unit
  Scenario: Testing a provider I cannot manage is refused
    Given a provider configured at a scope I cannot manage
    When I test its connection
    Then the test is refused
    And the credential is never sent anywhere

  @unit
  Scenario: A provider row carrying no scopes is not testable
    Given a provider row that grants no scopes at all
    When I test its connection
    Then the row is reported as not found
    And the credential is never sent anywhere

  @unit
  Scenario: Repeated tests are limited per organization
    Given I have tested connections many times in quick succession
    When I test another connection
    Then I am told to wait before testing again

  # The result of a check has three answers, and for a long time it had two.
  # A skipped probe returning the same value as a successful one is only
  # harmless while the answer is used to decide whether a save may proceed;
  # the moment a customer reads it, it becomes a false statement.

  @unit
  Scenario: A skipped check is distinguishable from a successful one
    Given a provider whose credential is never actually probed
    When the check runs
    Then the result says the check did not run
    And the result is not the same as a successful check

  @unit
  Scenario: Every reason a check does not run is reported as unchecked
    Given a check that does not reach the provider
    When the reason is that the provider uses credentials we cannot probe
    Or the reason is that the credential is masked
    Or the reason is that no credential is stored
    Or the reason is that the provider has no endpoint to probe
    Or the reason is that the provider is not one we recognize
    Then each of them reports that the check did not run

  # A provider that could not be asked at all is covered above, under the
  # unreachable-provider scenarios. It stays a raised error rather than a
  # third verdict: "we never got an answer" is the absence of one, and
  # folding it in here would make `unchecked` mean both "we chose not to
  # ask" and "we asked and nothing came back", which are different problems
  # with different next steps.

  @unit
  Scenario: Content safety credentials are never probed as a language model
    Given a content safety provider with an endpoint saved
    When the check runs
    Then the result says the check did not run
    And the credential is not sent to a models endpoint

  @unit
  Scenario: Saving is unaffected by the third answer
    Given a credential whose check did not run
    When it is saved
    Then the save proceeds exactly as it did before
