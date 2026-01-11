Feature: Default Provider Settings
  As a user configuring model providers
  I want to set a provider as the default for LangWatch features
  So that operations use my preferred provider automatically

  Background:
    Given I am logged in
    And I have access to a project
    And I have "project:manage" permission

  @visual
  Scenario: Default provider toggle section
    When I open the model provider configuration drawer for "openai"
    Then I see a "Use as default for LangWatch features" toggle

  @visual
  Scenario: Model selectors when default toggle enabled
    Given the default provider toggle is enabled
    When I am on the provider configuration drawer
    Then I see the following selectors:
      | selector               |
      | Default Model          |
      | Topic Clustering Model |
      | Embeddings Model       |

  @visual
  Scenario: Disabled toggle with tooltip
    Given the provider is used for default models
    When I open the model provider configuration drawer
    Then the default toggle is disabled
    And hovering shows a tooltip explaining why

  @integration
  Scenario: Toggle to set provider as default
    Given I open the model provider configuration drawer for "openai"
    When I toggle "Use openai as the default for LangWatch features" to enabled
    Then I see "Default Model" selector
    And I see "Topic Clustering Model" selector
    And I see "Embeddings Model" selector

  @integration
  Scenario: Select default model when enabling default provider
    Given I open the model provider configuration drawer for "openai"
    And I have "openai/gpt-4o" and "openai/gpt-4o-mini" available
    When I toggle "Use openai as the default for LangWatch features" to enabled
    Then the "Default Model" is set to a model from the openai provider
    And I can change the default model to any openai model

  @integration
  Scenario: Select topic clustering model
    Given I have "openai" provider configured as default
    When I open the model provider configuration drawer for "openai"
    And I select "openai/gpt-4o-mini" as the "Topic Clustering Model"
    And I click "Save"
    Then the topic clustering model is saved as "openai/gpt-4o-mini"

  @integration
  Scenario: Select embeddings model
    Given I have "openai" provider configured as default
    When I open the model provider configuration drawer for "openai"
    And I select "openai/text-embedding-3-small" as the "Embeddings Model"
    And I click "Save"
    Then the embeddings model is saved as "openai/text-embedding-3-small"

  @integration
  Scenario: Prevent disabling toggle when provider is used for Default Model
    Given I have "openai" provider configured as default
    And the project's default model is "openai/gpt-4o"
    When I open the model provider configuration drawer for "openai"
    Then the "Use openai as the default" toggle is checked
    And the toggle is disabled
    And a tooltip explains the provider is used for default models

  @integration
  Scenario: Prevent disabling toggle when only one provider enabled
    Given I have only "openai" provider enabled
    When I open the model provider configuration drawer for "openai"
    Then the "Use openai as the default" toggle is checked
    And the toggle is disabled
    And a tooltip explains this is the only enabled provider

  @integration
  Scenario: Show "Default Model" badge when default model belongs to provider
    Given I have "openai" provider enabled
    And the project's default model is "openai/gpt-4o"
    When I navigate to the Model Providers settings page
    Then I see the "openai" provider in the list
    And the "openai" provider row shows a "Default Model" badge

  @integration
  Scenario: Hide "Default Model" badge when default model does not belong to provider
    Given I have "openai" provider enabled
    And the project's default model is "anthropic/claude-sonnet-4"
    When I navigate to the Model Providers settings page
    Then I see the "openai" provider in the list
    And the "openai" provider row does not show a "Default Model" badge

  @integration
  Scenario: Include custom models in model selector options
    Given I have "openai" provider configured with custom model "gpt-5-custom"
    When I open the model provider configuration drawer for "openai"
    And I toggle "Use openai as the default" to enabled
    Then the "Default Model" selector includes "openai/gpt-5-custom"
    And I can select "openai/gpt-5-custom" as the default model

  @integration
  Scenario: Include custom embeddings from all enabled providers
    Given I have "openai" provider enabled with custom embedding "custom-embedding"
    And I have "anthropic" provider enabled
    When I open the model provider configuration drawer for "openai"
    And I toggle "Use openai as the default" to enabled
    Then the "Embeddings Model" selector includes "openai/custom-embedding"
    And the selector includes embeddings from all enabled providers

  @integration
  Scenario: Auto-sync model selections when toggling default provider on
    Given I have project default model set to "anthropic/claude-sonnet-4"
    When I open the model provider configuration drawer for "openai"
    And I toggle "Use openai as the default" to enabled
    Then the default model is changed to an openai model
    And the topic clustering model is changed to an openai model if needed
    And the embeddings model is changed to an openai model if needed

  @integration
  Scenario: Save default provider settings
    Given I open the model provider configuration drawer for "openai"
    When I toggle "Use openai as the default" to enabled
    And I select "openai/gpt-4o" as the "Default Model"
    And I select "openai/gpt-4o-mini" as the "Topic Clustering Model"
    And I select "openai/text-embedding-3-small" as the "Embeddings Model"
    And I click "Save"
    Then the provider is saved as default
    And the project's default model is updated to "openai/gpt-4o"
    And the project's topic clustering model is updated to "openai/gpt-4o-mini"
    And the project's embeddings model is updated to "openai/text-embedding-3-small"
