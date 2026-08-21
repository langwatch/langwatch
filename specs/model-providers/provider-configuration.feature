Feature: Model Provider Configuration
  As a user configuring a model provider
  I want to set up API keys, models, and provider-specific settings
  So that I can use the provider for LangWatch operations

  # Most remaining @unimplemented scenarios describe the provider drawer UI
  # (toggles, Custom Models section, extra-headers). Need a JSDOM render of
  # `ModelProviderForm` + the Custom Models / Extra Headers subforms. The
  # masking/preservation pieces are bound to `modelProvider.service.unit.test.ts`
  # (mergeCustomKeys / maskApiKeys). Aspirational pending the form harness.

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

  @integration @unimplemented
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

  @unit
  Scenario: Plaintext API keys never reach the browser through any provider query
    Given I have "openai" provider configured with API key "sk-actual123"
    And I have "project:update" permission
    When the app fetches the project's model providers from any page
    Then the API key is masked in the response
    And the plaintext API key does not appear anywhere in the response
    And non-secret values like the base URL remain visible

  @unit
  Scenario: Preserve original extra header values when saving with masked placeholders
    Given I have "custom" provider configured with extra headers
    When I save the provider with header values still masked
    Then the stored header values are preserved
    And a masked header that matches no stored header is not saved

  @unit
  Scenario: A user without project view permission cannot list a project's providers
    Given a project has "openai" provider configured with an API key
    And I have no permissions on that project
    When I request that project's model providers
    Then the request is rejected as unauthorized

  @unit
  Scenario: Access to a sibling project does not grant access to this project's providers
    Given a project has "openai" provider configured with an API key
    And I am an admin of a different project in the same organization
    When I request that project's model providers
    Then the request is rejected as unauthorized

  @unit
  Scenario: Admin rights in another organization grant nothing across the tenancy boundary
    Given a project has "openai" provider configured with an API key
    And I am an admin of a different organization
    When I request that project's model providers
    Then the request is rejected as unauthorized

  @integration
  Scenario: Preserve original API key when saving with masked placeholder
    Given I have "openai" provider configured with API key "sk-actual123"
    When I open the model provider configuration drawer for "openai"
    And I see "HAS_KEY••••••••••••••••••••••••" in the API key field
    And I change the base URL to "https://custom.openai.com/v1"
    And I click "Save"
    Then the original API key "sk-actual123" is preserved
    And the base URL is updated to "https://custom.openai.com/v1"

  # Editing headers changes headers. It must never touch the credentials.
  @integration
  Scenario: Adding an extra header keeps the stored Azure credentials
    Given I have "azure" provider configured with an API key and an endpoint
    When I open the model provider configuration drawer for "azure"
    And I leave every credential field untouched
    And I add an extra header "api-key" with a value
    And I click "Save"
    Then the extra header is saved
    And the stored API key and endpoint are preserved

  # Opening a provider and changing nothing is not an edit, whatever it holds.
  @integration
  Scenario: A stored extra header does not make the form dirty on open
    Given I have "azure" provider configured with an extra header
    When I open the model provider configuration drawer for "azure"
    And I change nothing
    Then the Save button is disabled

  # Emptying a field is an edit, so a credential can actually be removed.
  @integration
  Scenario: Clearing a stored API key enables Save
    Given I have "openai" provider configured with API key "sk-actual123"
    When I open the model provider configuration drawer for "openai"
    And I clear the API key field
    Then the Save button is enabled

  # A save that would leave a provider with no credential fails loudly rather
  # than quietly removing the one on file.
  @integration
  Scenario: A header-only payload is refused instead of dropping credentials
    Given I have "azure" provider configured with an API key and an endpoint
    When a save carries no credential for the provider
    Then the save is rejected with an error the customer can act on
    And the stored API key and endpoint are preserved

  # A row whose stored credentials will not decrypt reads back with none, so
  # the guard above cannot see them. The row still holds ciphertext that
  # restoring the old encryption secret would recover, and a save that carries
  # no replacement would overwrite it for good.
  @integration
  Scenario: An unreadable credential is not replaced by a save that carries none
    Given I have a provider whose stored credentials no longer decrypt
    When a save carries no credential for the provider
    Then the save is rejected with an error that names the unreadable credential
    And the stored value is left exactly as it was

  # A save that names one credential is editing that one. An API key is never
  # shown back, so nobody can send one they did not type, and leaving it out
  # asks for nothing rather than asking for its removal.
  @integration
  Scenario: A save that names one credential keeps the ones it leaves out
    Given I have "azure" provider configured with an API key and an endpoint
    When a save carries a new endpoint and no API key
    Then the endpoint is updated
    And the stored API key is preserved

  # Everything else is on screen, so a save states it in full. That is how the
  # API gateway option switches over, and it must not take the key with it.
  @integration
  Scenario: Switching Azure to its API gateway keeps the key and drops the direct endpoint
    Given I have "azure" provider configured with an API key and an endpoint
    When I switch the provider to its API gateway and save
    Then the direct endpoint gives way to the gateway address
    And the stored API key is preserved

  @integration @unimplemented
  Scenario: Configure API keys from environment variables
    Given I have "openai" provider enabled via environment variable "OPENAI_API_KEY"
    And the provider has no stored customKeys
    When I open the model provider configuration drawer for "openai"
    Then the "OPENAI_API_KEY" field shows "HAS_KEY••••••••••••••••••••••••"
    And the field indicates the key comes from environment variables

  @integration @unimplemented
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

  @integration @unimplemented
  Scenario: Configure extra headers for Azure provider
    Given I open the model provider configuration drawer for "azure"
    When I add an extra header with key "api-key" and value "test-value"
    And I click "Save"
    Then the extra header is saved
    And the header is included in API requests

  @integration @unimplemented
  Scenario: Configure extra headers for Custom provider
    Given I open the model provider configuration drawer for "custom"
    When I add an extra header with key "X-Custom-Header" and value "custom-value"
    And I click "Save"
    Then the extra header is saved

  @integration @unimplemented
  Scenario: Toggle API Gateway for Azure provider
    Given I open the model provider configuration drawer for "azure"
    When I toggle "Use API Gateway" to enabled
    Then I see "AZURE_API_GATEWAY_BASE_URL" field
    And I see "AZURE_API_GATEWAY_VERSION" field
    And I do not see "AZURE_OPENAI_API_KEY" field
    And I do not see "AZURE_OPENAI_ENDPOINT" field

  @integration @unimplemented
  Scenario: Toggle API Gateway off for Azure provider
    Given I have Azure provider configured with API Gateway enabled
    When I open the model provider configuration drawer for "azure"
    And I toggle "Use API Gateway" to disabled
    Then I see "AZURE_OPENAI_API_KEY" field
    And I see "AZURE_OPENAI_ENDPOINT" field
    And I do not see "AZURE_API_GATEWAY_BASE_URL" field

  @integration @unimplemented
  Scenario: Configure base URL for provider
    Given I open the model provider configuration drawer for "openai"
    When I enter "https://custom.openai.com/v1" in the "OPENAI_BASE_URL" field
    And I click "Save"
    Then the base URL is saved
    And API requests use the custom base URL

  @integration @unimplemented
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

  @integration @unimplemented
  Scenario: Show field validation errors for invalid input
    Given I open the model provider configuration drawer for "openai"
    When I leave the required "OPENAI_API_KEY" field empty
    And I click "Save"
    Then I see a validation error for "OPENAI_API_KEY"
    And the provider is not saved

  @integration @unimplemented
  Scenario: Clear validation errors when user starts typing
    Given I open the model provider configuration drawer for "openai"
    And I see a validation error for "OPENAI_API_KEY"
    When I start typing in the "OPENAI_API_KEY" field
    Then the validation error is cleared

  # A provider that reaches a self-hosted endpoint needs no API key: the
  # endpoint decides. The drawer asks for exactly what the provider needs,
  # so nobody has to invent a value to get past a required field, and no
  # invented value travels to their server.

  @integration
  Scenario Outline: The API key stops being required once a base URL is entered
    Given I open the model provider configuration drawer for "<provider>"
    Then the API key field is marked required
    When I enter "https://llm.acme.internal/v1" in the base URL field
    Then the API key field is not marked required
    And it is marked required again when I clear the base URL

    Examples:
      | provider  |
      | openai    |
      | anthropic |

  @integration
  Scenario Outline: A self-hosted endpoint is saved with no API key at all
    Given I open the model provider configuration drawer for "<provider>"
    When I enter "https://llm.acme.internal/v1" in the base URL field
    And I leave the API key field empty
    And I click "Save"
    Then the provider is saved
    And the API key is saved empty, so nothing is sent to my endpoint as a credential

    Examples:
      | provider  |
      | openai    |
      | anthropic |

  @integration
  Scenario Outline: Saving with neither an API key nor a base URL says what to enter
    Given I open the model provider configuration drawer for "<provider>"
    When I leave both credential fields empty
    And I click "Save"
    Then I see "Add an API key, or a base URL if your endpoint does not need one." next to the API key field
    And the provider is not saved

    Examples:
      | provider  |
      | openai    |
      | anthropic |

  @integration
  Scenario: A provider with a single credential keeps its required marker
    Given I open the model provider configuration drawer for "gemini"
    Then the "GEMINI_API_KEY" field is marked required
    And no base URL field is offered

  # A stored base URL belongs to the customer like any other field: the
  # drawer shows it as saved, and removing it is an ordinary edit. This
  # pins a failure mode where emptying the field did not count as a change,
  # so Save stayed disabled and the endpoint could never be taken off.
  # Its sibling failure, an edit next to a masked key deleting that key, is
  # pinned by "Preserve original API key when saving with masked
  # placeholder" above.

  @integration
  Scenario Outline: Removing the base URL is a change that can be saved
    Given I have "<provider>" configured with a saved API key and base URL "https://llm.acme.internal/v1"
    When I open its model provider configuration drawer
    Then the base URL field shows the stored value
    When I clear the base URL field
    Then I can save the removal
    And the saved API key is still on file afterwards

    Examples:
      | provider  |
      | openai    |
      | anthropic |
