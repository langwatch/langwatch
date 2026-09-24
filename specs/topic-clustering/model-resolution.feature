# Issue #8287: scheduled topic clustering failed daily for projects whose FAST
# role default was a Codex model. Codex resolves for the FAST tier but topic
# clustering runs through langevals/litellm (never the AI gateway), which
# refuses Codex — so the model was licensed at resolution then rejected at
# execution, and the settings page mislabelled the failure as our fault.
Feature: Topic clustering model resolution skips Codex models
  As someone whose coding default is a Codex model
  I want topic clustering to fall back to a runnable model, or tell me plainly
  So that my scheduled clustering does not fail silently every day

  Background:
    Given a project with topic clustering enabled

  @unit
  Scenario: A codex FAST default is skipped in favor of a wider tier
    Given the project's Fast default is a Codex model
    And a wider scope sets Fast to a runnable model
    When topic clustering resolves its model
    Then it uses the wider scope's runnable model
    And the Codex model is not used for topic clustering

  @unit
  Scenario: Exhaustion caused only by codex models reports the restriction, not missing configuration
    Given every configured Fast value for the project is a Codex model
    When topic clustering resolves its model
    Then resolution fails as a restricted-model error, not a missing-configuration error
    And the error names the Codex model that had to be skipped

  @unit
  Scenario: A codex topic clustering override is skipped
    Given topic clustering has a per-feature override set to a Codex model
    And a wider scope sets Fast to a runnable model
    When topic clustering resolves its model
    Then the override is skipped and the runnable model is used

  @unit
  Scenario: Other fast assists still resolve the codex FAST default
    Given the project's Fast default is a Codex model
    When a runnable fast assist resolves its model
    Then it uses the Codex model as before

  @unit
  Scenario: Embeddings never resolve a codex model
    Given the project's Embeddings value is a Codex model
    When topic clustering resolves its embeddings model
    Then resolution fails as a restricted-model error

  @unit
  Scenario: A restricted model failure is the customer's to fix
    Given a topic clustering run failed because only a Codex model was configured
    When the failure is classified
    Then it is reported as a user-actionable restricted-model failure

  @unit
  Scenario: The settings page shows guidance and a link for a restricted model failure
    Given a topic clustering run failed with a restricted-model error
    When the customer opens the topic clustering settings page
    Then the page explains a Codex model cannot serve topic clustering
    And offers a link to the Model Providers settings to choose another model
