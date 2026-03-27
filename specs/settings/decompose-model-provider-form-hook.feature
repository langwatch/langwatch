Feature: Decompose useModelProviderForm hook into focused sub-hooks
  As a developer maintaining the model provider settings form
  I want the hook logic organized into single-responsibility sub-hooks
  So that each concern is independently testable and the code is easier to navigate

  Background:
    Given the useModelProviderForm hook returns [state, actions]
    And two consumer components depend on the public API

  @refactor @integration
  Scenario: Public API remains unchanged after decomposition
    When the hook is decomposed into sub-hooks
    Then the UseModelProviderFormParams type is unchanged
    And the UseModelProviderFormState type is unchanged
    And the UseModelProviderFormActions type is unchanged
    And both consumer components work without modification

  @refactor @integration
  Scenario: All existing integration tests pass without modification
    When the hook is decomposed into sub-hooks
    Then all tests in useModelProviderForm.integration.test.tsx pass
    And no test file modifications are needed

  @refactor
  Scenario: Credential keys are managed by a dedicated sub-hook
    When the hook is decomposed
    Then useCredentialKeys owns useApiGateway, customKeys, displayKeys, and initialKeys state
    And useCredentialKeys provides setUseApiGateway, setCustomKey, and setManaged actions
    And useCredentialKeys has its own reset logic for provider changes

  @refactor
  Scenario: Extra headers are managed by a dedicated sub-hook
    When the hook is decomposed
    Then useExtraHeaders owns the extraHeaders state
    And useExtraHeaders provides add, remove, toggle, and field-update actions
    And useExtraHeaders exposes ensureApiKeyHeader for Azure gateway coupling

  @refactor
  Scenario: Custom models are managed by a dedicated sub-hook
    When the hook is decomposed
    Then useCustomModels owns customModels and customEmbeddingsModels state
    And useCustomModels provides add, remove, and replace actions for both model types
    And useCustomModels has its own reset logic for provider changes

  @refactor
  Scenario: Default provider selection is managed by a dedicated sub-hook
    When the hook is decomposed
    Then useDefaultProviderSelection owns useAsDefaultProvider and the three project model states
    And useDefaultProviderSelection computes resolvedDefaults
    And useDefaultProviderSelection has its own reset logic for provider and project changes

  @refactor
  Scenario: Form submission is managed by a dedicated sub-hook
    When the hook is decomposed
    Then useProviderFormSubmit owns isSaving and errors state
    And useProviderFormSubmit provides submit and setEnabled actions
    And useProviderFormSubmit reads current form state via a snapshot callback

  @refactor
  Scenario: Azure API gateway toggle coordinates credential keys and extra headers
    Given the provider is "azure"
    When the user toggles the API gateway on
    Then credential keys switch to gateway display keys
    And an api-key extra header is added if none exist
    And the coordination happens through the orchestrator, not direct sub-hook coupling

  @refactor
  Scenario: Single reset effect in orchestrator replaces monolithic reset
    When the provider or project changes
    Then each sub-hook's reset is called in sequence
    And the credential keys reset returns the new useApiGateway value
    And that value is passed to the extra headers reset
    And no state is left stale from the previous provider

  @refactor
  Scenario: Orchestrator hook is under 120 lines
    When the decomposition is complete
    Then useModelProviderForm is a thin orchestrator
    And it calls the five sub-hooks
    And it wires cross-cutting callbacks
    And it assembles and returns the public state and actions tuple

  @refactor
  Scenario: Helper functions remain untouched
    When the hook is decomposed
    Then modelProviderHelpers.ts is not modified
    And sub-hooks import helpers directly as needed
