Feature: Azure safety evaluators require BYOK provider
  As a platform operator
  I want Azure Content Safety, Prompt Injection, and Jailbreak evaluators to require a project-level Azure Safety provider
  So that customers pay Microsoft directly for their own Azure Content Safety usage

  Background:
    Given I am logged in
    And I have access to a project
    And I have "project:manage" permission

  # ============================================================================
  # Evaluator Type Selector Drawer gating
  # ============================================================================

  @integration
  Scenario: Azure evaluators are disabled when no Azure Safety provider is configured
    Given the project has no "azure_safety" model provider configured
    When I open the evaluator type selector for the "Safety" category
    Then the "Azure Content Safety" card is disabled
    And the "Azure Prompt Injection" card is disabled
    And the "Azure Jailbreak Detection" card is disabled
    And each disabled card shows a tooltip saying "Configure Azure Safety provider in Settings → Model Providers"

  @integration
  Scenario: Disabled Azure card shows CTA to configure the provider
    Given the project has no "azure_safety" model provider configured
    When I open the evaluator type selector for the "Safety" category
    And I click the "Configure Azure Safety" link on the "Azure Content Safety" card
    Then I navigate to the model providers settings page
    And the Azure Safety provider configuration drawer opens

  @integration
  Scenario: Configuring Azure Safety enables all three Azure evaluators
    Given the project has no "azure_safety" model provider configured
    And the evaluator type selector is open on the "Safety" category
    When I configure the "azure_safety" provider with valid credentials
    And I re-open the evaluator type selector for the "Safety" category
    Then the "Azure Content Safety" card is enabled
    And the "Azure Prompt Injection" card is enabled
    And the "Azure Jailbreak Detection" card is enabled

  @integration
  Scenario: Disabled Azure provider counts as not configured
    Given the project has an "azure_safety" model provider with disabled=true
    When I open the evaluator type selector for the "Safety" category
    Then the "Azure Content Safety" card is disabled

  @integration
  Scenario: Non-Azure safety evaluators are unaffected by Azure Safety config
    Given the project has no "azure_safety" model provider configured
    When I open the evaluator type selector for the "Safety" category
    Then non-Azure safety evaluators remain enabled
    And I can select them to create a monitor

  # ============================================================================
  # availableEvaluators router
  # ============================================================================

  @integration
  Scenario: availableEvaluators reports missing env vars for Azure when provider is absent
    Given the project has no "azure_safety" model provider configured
    When the client queries availableEvaluators for the project
    Then the response marks the following evaluators with missingEnvVars:
      | evaluator              | missingEnvVars                                            |
      | azure/content_safety   | AZURE_CONTENT_SAFETY_ENDPOINT, AZURE_CONTENT_SAFETY_KEY   |
      | azure/prompt_injection | AZURE_CONTENT_SAFETY_ENDPOINT, AZURE_CONTENT_SAFETY_KEY   |
      | azure/jailbreak        | AZURE_CONTENT_SAFETY_ENDPOINT, AZURE_CONTENT_SAFETY_KEY   |

  @integration
  Scenario: availableEvaluators reports no missing env vars when provider is fully configured
    Given the project has an enabled "azure_safety" model provider with both keys set
    When the client queries availableEvaluators for the project
    Then the response marks the Azure evaluators with an empty missingEnvVars list

  @integration
  Scenario: availableEvaluators ignores process.env for Azure evaluators
    Given the process environment has AZURE_CONTENT_SAFETY_ENDPOINT and AZURE_CONTENT_SAFETY_KEY set
    And the project has no "azure_safety" model provider configured
    When the client queries availableEvaluators for the project
    Then the response still marks Azure evaluators as missing both env vars

  # ============================================================================
  # Runtime skip for ON_MESSAGE monitors
  # ============================================================================

  @integration
  Scenario: ON_MESSAGE monitor using azure/content_safety without provider emits skipped
    Given a monitor with checkType "azure/content_safety" enabled ON_MESSAGE
    And the project has no "azure_safety" model provider configured
    When a trace is processed that matches the monitor
    Then the evaluation is reported with status "skipped"
    And the details say "Azure Safety provider not configured. Configure it in Settings → Model Providers to run this evaluator."
    And the langevals client is not called

  @integration
  Scenario: ON_MESSAGE monitor using azure/prompt_injection without provider emits skipped
    Given a monitor with checkType "azure/prompt_injection" enabled ON_MESSAGE
    And the project has no "azure_safety" model provider configured
    When a trace is processed that matches the monitor
    Then the evaluation is reported with status "skipped"
    And the details say "Azure Safety provider not configured. Configure it in Settings → Model Providers to run this evaluator."
    And the langevals client is not called

  @integration
  Scenario: ON_MESSAGE monitor using azure/jailbreak without provider emits skipped
    Given a monitor with checkType "azure/jailbreak" enabled ON_MESSAGE
    And the project has no "azure_safety" model provider configured
    When a trace is processed that matches the monitor
    Then the evaluation is reported with status "skipped"
    And the details say "Azure Safety provider not configured. Configure it in Settings → Model Providers to run this evaluator."
    And the langevals client is not called

  @integration
  Scenario: Configured Azure provider passes keys to langevals at runtime
    Given a monitor with checkType "azure/content_safety" enabled ON_MESSAGE
    And the project has an enabled "azure_safety" provider with:
      | key                              | value                                              |
      | AZURE_CONTENT_SAFETY_ENDPOINT    | https://my-account.cognitiveservices.azure.com/   |
      | AZURE_CONTENT_SAFETY_KEY         | my-subscription-key                                |
    When a trace is processed that matches the monitor
    Then the langevals client is called with env containing both keys
    And the evaluation is reported with status "processed"

  @integration
  Scenario: Existing disabled monitors start succeeding after provider is configured
    Given a monitor with checkType "azure/content_safety" enabled ON_MESSAGE
    And the project has no "azure_safety" model provider configured
    And a previous trace produced a "skipped" evaluation
    When the user configures the "azure_safety" provider with valid credentials
    And a new trace is processed that matches the monitor
    Then the new evaluation is reported with status "processed"
    And the monitor did not need to be re-enabled

  @integration
  Scenario: Runtime skip ignores process.env for Azure evaluators
    Given the process environment has AZURE_CONTENT_SAFETY_ENDPOINT and AZURE_CONTENT_SAFETY_KEY set
    And the project has no "azure_safety" model provider configured
    And a monitor with checkType "azure/content_safety" enabled ON_MESSAGE
    When a trace is processed that matches the monitor
    Then the evaluation is reported with status "skipped"
    And the langevals client is not called
