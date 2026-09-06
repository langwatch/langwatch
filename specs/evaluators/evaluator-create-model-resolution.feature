Feature: Creating an evaluator asks only for the models its type needs
  As a member whose organization already has model providers enabled
  I want an evaluator create to resolve only the model roles its type uses
  So that a type with no embeddings field is not refused for a missing embeddings default

  # The failure this spec pins: the REST create resolved BOTH the default chat
  # model and the embeddings model for every evaluator type. An organization
  # whose default config carries DEFAULT and FAST but no EMBEDDINGS key could
  # therefore not create a faithfulness evaluator, whose settings schema has no
  # embeddings_model field at all. The refusal named a model the evaluator
  # never uses.

  # ============================================================================
  # Resolution follows the evaluator's settings schema
  # ============================================================================

  @unit
  Scenario: A type whose settings carry no embeddings_model asks for no embeddings model
    Given the evaluator type "ragas/faithfulness"
    When the model roles its settings need are read
    Then a default chat model is needed
    And an embeddings model is not needed

  @unit
  Scenario: A type whose settings carry embeddings_model asks for both
    Given the evaluator type "ragas/response_relevancy"
    When the model roles its settings need are read
    Then a default chat model is needed
    And an embeddings model is needed

  @unit
  Scenario: A type with neither field asks for no model at all
    Given the evaluator type "langevals/exact_match"
    When the model roles its settings need are read
    Then a default chat model is not needed
    And an embeddings model is not needed

  @unit
  Scenario: An unknown or custom evaluator asks for no model at all
    Given an evaluator definition with no settings schema
    When the model roles its settings need are read
    Then a default chat model is not needed
    And an embeddings model is not needed

  @integration
  Scenario: A faithfulness evaluator is created with no embeddings default configured
    Given an organization whose default models carry DEFAULT and FAST but no EMBEDDINGS
    When I create an evaluator of type "ragas/faithfulness" over the API
    Then the evaluator is created
    And its settings carry the organization's default chat model

  @integration
  Scenario: A type that does need embeddings still refuses when none is configured
    Given an organization whose default models carry DEFAULT and FAST but no EMBEDDINGS
    When I create an evaluator of type "ragas/response_relevancy" over the API
    Then the request fails with code "model_not_configured"

  # ============================================================================
  # The refusal names where to set the model
  # ============================================================================

  @unit
  Scenario: The missing-model refusal names the settings page that fixes it
    Given a feature whose model cannot be resolved at any scope
    When the refusal is raised
    Then a tip names the Default Models settings page
    And a tip names the organization scope as the place to set it for everyone
    And the refusal links to the model providers documentation

  @unit
  Scenario: The command line offers the same next steps
    Given the code "model_not_configured" reaches the command line with no server tips
    When the failure is rendered
    Then the suggestions name the Default Models settings page
