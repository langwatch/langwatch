Feature: Model params preparation error feedback
  As a LangWatch user
  I want to see specific error messages when scenario model params preparation fails
  So that I can quickly diagnose and fix model configuration issues

  # ============================================================================
  # Factory-level structured errors - Unit Tests
  # ============================================================================
  # The production modelParamsProvider (in createDataPrefetcherDependencies)
  # currently returns null for all failure cases. Each case must return a
  # ModelParamsResult with a specific reason code and actionable message.

  @unit
  Scenario: Reject model string without provider prefix
    Given a model string "gpt-4" without a slash separator
    When model params preparation runs
    Then it returns failure with reason "invalid_model_format"
    And the error message includes "gpt-4"
    And the error message explains the expected "provider/model" format

  @unit
  Scenario: Reject model when provider is not found in project
    Given a model string "azure/gpt-4" with valid format
    And the project has no provider named "azure"
    When model params preparation runs
    Then it returns failure with reason "provider_not_found"
    And the error message includes the provider name "azure"

  @unit
  Scenario: Reject model when provider exists but is not enabled
    Given a model string "azure/gpt-4" with valid format
    And the project has provider "azure" but it is disabled
    When model params preparation runs
    Then it returns failure with reason "provider_not_enabled"
    And the error message includes the provider name "azure"

  @unit
  Scenario: Reject when resolved params are missing API key
    Given a model string "openai/gpt-4" with valid format
    And the provider "openai" is enabled
    But prepareLitellmParams returns params without an API key
    When model params preparation runs
    Then it returns failure with reason "missing_params"
    And the error message mentions missing API key or model

  @unit
  Scenario: Reject when resolved params are missing model
    Given a model string "openai/gpt-4" with valid format
    And the provider "openai" is enabled
    But prepareLitellmParams returns params without a model field
    When model params preparation runs
    Then it returns failure with reason "missing_params"
    And the error message mentions missing API key or model

  @unit
  Scenario: Return preparation_error on unexpected exception
    Given a model string "openai/gpt-4" with valid format
    And getProjectModelProviders throws an unexpected error
    When model params preparation runs
    Then it returns failure with reason "preparation_error"
    And the error message includes the original error detail

  @unit
  Scenario: Return success with LiteLLM params on valid configuration
    Given a model string "openai/gpt-4" with valid format
    And the provider "openai" is enabled with a valid API key
    When model params preparation runs
    Then it returns success with the resolved LiteLLM params

  # ============================================================================
  # Prefetcher propagates structured errors - Unit Tests
  # ============================================================================
  # prefetchScenarioData must forward the reason code and actionable message
  # from the modelParamsProvider instead of a generic error.

  @unit
  Scenario: Prefetcher forwards reason code from model params failure
    Given modelParamsProvider returns failure with reason "provider_not_enabled"
    And the failure message is "Provider 'azure' is not enabled for this project"
    When prefetchScenarioData is called
    Then the result includes reason "provider_not_enabled"
    And the error message is "Provider 'azure' is not enabled for this project"

  @unit
  Scenario: Prefetcher logs model params failure with reason
    Given modelParamsProvider returns failure with reason "invalid_model_format"
    When prefetchScenarioData is called
    Then the log entry includes the reason code "invalid_model_format"
    And the log entry includes the model string that failed

  # ============================================================================
  # Error surfaces through TRPC layer - Integration Tests
  # ============================================================================
  # The TRPC router that triggers scenario execution must surface the
  # structured error so the frontend can display an actionable message.

  @integration
  Scenario: TRPC layer returns actionable error for invalid model format
    Given a project with a prompt configured with model "gpt-4"
    When a scenario run is triggered via the TRPC endpoint
    Then the response contains an error message explaining the "provider/model" format
    And the error is not the generic "Failed to prepare model params"

  @integration
  Scenario: TRPC layer returns actionable error for disabled provider
    Given a project with provider "azure" that is disabled
    And a prompt configured with model "azure/gpt-4"
    When a scenario run is triggered via the TRPC endpoint
    Then the response contains an error mentioning provider "azure" is not enabled

  @integration
  Scenario: TRPC layer returns actionable error for missing API key
    Given a project with provider "openai" enabled but no API key
    And a prompt configured with model "openai/gpt-4"
    When a scenario run is triggered via the TRPC endpoint
    Then the response contains an error mentioning missing API key
