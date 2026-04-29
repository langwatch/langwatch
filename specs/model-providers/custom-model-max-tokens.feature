Feature: Max Tokens is universal for chat models
  Every chat model is token-based and accepts a max_tokens limit at invocation time.
  The Max Tokens slider must always render in the LLM config popover for chat
  models, regardless of what supportedParameters the model entry declares. There
  is no opt-out at the model-registration level.

  This contract was tightened after a managed-Bedrock customer registered a
  custom chat model whose supportedParameters list did not include max_tokens
  (the previous default). The popover then hid the slider after the model
  metadata loaded — a flicker, then nothing — leaving the user unable to set
  per-invocation output limits.

  @integration @unimplemented
  Scenario: Max Tokens slider always renders for a chat model with a token ceiling
    Given a chat model whose stored supportedParameters does NOT include "max_tokens"
    And the model has a configured maxTokens ceiling
    When a user opens the LLM Config popover for that model
    Then the Max Tokens slider is visible
    And the slider's maximum equals the model's configured maxTokens ceiling

  @integration @unimplemented
  Scenario: Max Tokens slider renders without a flicker for managed-Bedrock custom models
    Given a managed Bedrock provider configured for the organization
    And the admin has registered a Bedrock chat model with supportedParameters ["temperature"]
    When a user opens an LLM-as-judge evaluator drawer for that model
    Then the Max Tokens slider is visible from first paint
    And it does not disappear after model metadata finishes loading

  @integration @unimplemented
  Scenario: Add Custom Model dialog does not expose Max Tokens as a supported-parameter checkbox
    Given I am an org admin on the model provider settings page
    When I open the Add Custom Model dialog for a chat model
    Then the Supported Parameters checkbox list does NOT include "Max Tokens"
    And the numeric "Max Tokens" field above (the model's ceiling) is still required

  @integration @unimplemented
  Scenario: Max Tokens slider renders for a reasoning chat model
    Given a chat model that supports the unified reasoning parameter
    And the model entry's supportedParameters list omits "max_tokens"
    When a user opens the LLM Config popover for that model
    Then the Max Tokens slider is visible alongside the Reasoning selector

  @integration @unimplemented
  Scenario: Embedding popovers are unaffected
    Given an embedding model
    When a user opens the embedding configuration UI
    Then no Max Tokens slider is rendered
