Feature: Custom Model Max Tokens Parameter
  As an admin registering a custom chat model (e.g. a Bedrock model routed through a managed provider)
  I want to declare that the model supports the max_tokens sampling parameter
  So that users in my organization can configure the output limit per workflow node and per LLM-as-judge evaluator

  Background:
    Given I am an org admin on the model provider settings page
    And I have opened the Add Custom Model dialog for a chat model

  @integration @unimplemented
  Scenario: max_tokens appears as a supported parameter option
    When I view the Supported Parameters checkbox list
    Then I should see a "Max Tokens" checkbox alongside Temperature, Top P, Top K, and Reasoning

  @integration @unimplemented
  Scenario: max_tokens is enabled by default for new custom models
    When I open the dialog to add a new model
    Then the "Max Tokens" checkbox should be checked
    And the "Temperature" checkbox should be checked

  @integration @unimplemented
  Scenario: Admin can opt out of max_tokens for reasoning-only models
    Given I am registering a reasoning-only custom model
    When I uncheck the "Max Tokens" checkbox
    And I save the custom model
    Then the saved custom model should not include "max_tokens" in its supportedParameters

  @integration @unimplemented
  Scenario: Custom model with max_tokens enabled shows the slider in the LLM config popover
    Given I have saved a custom chat model with supportedParameters including "max_tokens"
    When a user opens the LLM Config popover for that model on a workflow LLM node
    Then they should see the Max Tokens slider
    And the slider's maximum should respect the custom model's declared maxTokens ceiling

  @integration @unimplemented
  Scenario: Custom model with max_tokens enabled exposes the slider in LLM-as-judge evaluators
    Given I have saved a custom chat model with supportedParameters including "max_tokens"
    When a user opens the LLM config popover on a custom LLM evaluator (boolean, score, or category)
    Then they should see the Max Tokens slider

  @integration @unimplemented
  Scenario: Editing an existing custom model preserves the max_tokens setting
    Given I have previously saved a custom model with "max_tokens" in its supportedParameters
    When I open the dialog to edit that model
    Then the "Max Tokens" checkbox should be checked
