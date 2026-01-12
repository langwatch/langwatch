Feature: Provider Deletion
  As a user managing model providers
  I want to delete providers I no longer need
  So that I can keep my configuration clean

  Background:
    Given I am logged in
    And I have access to a project
    And I have "project:manage" permission

  @visual
  Scenario: Delete confirmation dialog structure
    When I open the delete dialog for a provider
    Then I see a dialog with:
      | element       |
      | Dialog title  |
      | Warning text  |
      | Cancel button |
      | Delete button |

  @visual
  Scenario: Blocked deletion dialog shows reasons
    Given the provider is used for default models
    When I open the delete dialog
    Then I see blocking reasons as a bulleted list
    And the "Delete" button appears disabled

  @integration
  Scenario: Show delete confirmation dialog
    Given I have "openai" provider enabled
    When I click the menu button for "openai" provider
    And I click "Delete Provider"
    Then I see a confirmation dialog
    And the dialog title is "Delete openai?"
    And the dialog shows "This provider will no longer be available for use."

  @integration
  Scenario: Prevent deletion when provider used for Default Model
    Given I have "openai" provider enabled
    And the project's default model is "openai/gpt-4o"
    When I click the menu button for "openai" provider
    And I click "Delete Provider"
    Then I see a confirmation dialog
    And the dialog shows "This provider is currently being used for one or more default models and cannot be deleted."
    And the dialog lists "• Default Model" as a blocking reason
    And the "Delete" button is disabled

  @integration
  Scenario: Prevent deletion when provider used for Topic Clustering Model
    Given I have "openai" provider enabled
    And the project's topic clustering model is "openai/gpt-4o-mini"
    When I click the menu button for "openai" provider
    And I click "Delete Provider"
    Then I see a confirmation dialog
    And the dialog shows the provider cannot be deleted
    And the dialog lists "• Topic Clustering Model" as a blocking reason
    And the "Delete" button is disabled

  @integration
  Scenario: Prevent deletion when provider used for Embeddings Model
    Given I have "openai" provider enabled
    And the project's embeddings model is "openai/text-embedding-3-small"
    When I click the menu button for "openai" provider
    And I click "Delete Provider"
    Then I see a confirmation dialog
    And the dialog shows the provider cannot be deleted
    And the dialog lists "• Embeddings Model" as a blocking reason
    And the "Delete" button is disabled

  @integration
  Scenario: Show all blocking reasons when provider used for multiple defaults
    Given I have "openai" provider enabled
    And the project's default model is "openai/gpt-4o"
    And the project's topic clustering model is "openai/gpt-4o-mini"
    And the project's embeddings model is "openai/text-embedding-3-small"
    When I click the menu button for "openai" provider
    And I click "Delete Provider"
    Then I see a confirmation dialog
    And the dialog lists "• Default Model"
    And the dialog lists "• Topic Clustering Model"
    And the dialog lists "• Embeddings Model"
    And the "Delete" button is disabled

  @integration
  Scenario: Allow deletion when provider not used for defaults
    Given I have "openai" provider enabled
    And the project's default model is "anthropic/claude-sonnet-4"
    When I click the menu button for "openai" provider
    And I click "Delete Provider"
    Then I see a confirmation dialog
    And the dialog shows "This provider will no longer be available for use."
    And the "Delete" button is enabled

  @integration
  Scenario: Successfully delete provider
    Given I have "openai" provider enabled
    And the provider is not used for any default models
    When I click the menu button for "openai" provider
    And I click "Delete Provider"
    And I confirm the deletion
    Then the provider is deleted
    And the provider no longer appears in the provider list
    And the dialog closes

  @integration
  Scenario: Cancel deletion
    Given I have "openai" provider enabled
    When I click the menu button for "openai" provider
    And I click "Delete Provider"
    And I click "Cancel"
    Then the dialog closes
    And the provider remains enabled
    And the provider still appears in the provider list

  @integration
  Scenario: Disable delete option without manage permission
    Given I do not have "project:manage" permission
    When I navigate to the Model Providers settings page
    Then the menu button for providers is disabled
    And a tooltip explains I need model provider manage permissions
