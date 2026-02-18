Feature: Custom Models Management
  As a user configuring a model provider
  I want to manage custom models through a structured interface
  So that I can add models with proper metadata and see them alongside registry models

  Background:
    Given I am logged in
    And I have access to a project
    And I have "project:manage" permission

  # Custom Models Section in Provider Drawer

  @integration
  Scenario: Custom Models section appears in provider drawer
    When I open the model provider configuration drawer for "openai"
    Then I see a "Custom Models" section
    And the section shows an empty table when no custom models exist
    And I see an "+ Add" button

  @integration
  Scenario: Add button shows options for model types
    Given I open the model provider configuration drawer for "openai"
    When I click the "+ Add" button
    Then I see a menu with options:
      | Add model            |
      | Add embeddings model |

  # Add Model Dialog

  @integration
  Scenario: Add model dialog shows all configuration fields
    Given I open the model provider configuration drawer for "openai"
    And I click the "+ Add" button
    When I select "Add model"
    Then I see a dialog with the following fields:
      | field             | type       |
      | Model ID          | text input |
      | Display Name      | text input |
      | Max Tokens        | text input |
    And I see parameter checkboxes for supported parameters
    And I see response format options
    And I see input type options

  # Add Embeddings Model Dialog

  @integration
  Scenario: Add embeddings model dialog shows minimal fields
    Given I open the model provider configuration drawer for "openai"
    And I click the "+ Add" button
    When I select "Add embeddings model"
    Then I see a dialog with only the following fields:
      | field        | type       |
      | Model ID     | text input |
      | Display Name | text input |

  # Managing Custom Models

  @integration
  Scenario: Adding a model through the dialog adds it to the table
    Given I open the model provider configuration drawer for "openai"
    And I click the "+ Add" button
    And I select "Add model"
    When I fill in "Model ID" with "gpt-5-custom"
    And I fill in "Display Name" with "GPT-5 Custom"
    And I confirm the dialog
    Then "GPT-5 Custom" appears in the custom models table

  @integration
  Scenario: Removing a custom model from the table
    Given I have a custom model "gpt-5-custom" configured for "openai"
    And I open the model provider configuration drawer for "openai"
    When I delete "gpt-5-custom" from the custom models table
    Then "gpt-5-custom" no longer appears in the custom models table

  # See All Models

  @integration
  Scenario: See all models link opens read-only registry modal
    Given I open the model provider configuration drawer for "openai"
    When I click the "See all models" link
    Then I see a read-only modal listing all registry models for "openai"
    And the modal does not allow editing

  # Custom Models in ModelSelector

  @integration
  Scenario: Custom models appear alongside registry models in ModelSelector
    Given I have a custom model "gpt-5-custom" configured for "openai"
    When I open the model selector dropdown
    Then I see "gpt-5-custom" in the OpenAI provider group
    And I also see standard registry models for OpenAI

  # Custom Model Metadata in Config Settings

  @integration
  Scenario: Custom model metadata drives config settings
    Given I have a custom model with specific parameter support and max tokens
    When I select that custom model in the model selector
    And I open the LLM Config popover
    Then the config settings reflect the custom model metadata
    And the max tokens slider uses the custom model max tokens limit

  # Migration Logic

  @unit
  Scenario: Migration drops custom models that match registry entries
    Given a provider has custom models stored as plain strings
    And some custom model names match existing registry models
    When the migration runs
    Then matching models are removed from the custom models list
    And non-matching models are converted to structured entries with Model ID and Display Name
