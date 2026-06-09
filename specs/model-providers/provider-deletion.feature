Feature: Provider Deletion
  As a user managing model providers
  I want to delete providers I no longer need
  So that I can keep my configuration clean

  # All scenarios describe the delete-confirmation dialog UI (menu trigger,
  # blocking-reasons list when default models bind the provider). Need a
  # JSDOM render of `DeleteProviderDialog` + integration test against
  # `modelProviderService.deleteModelProvider`. The scope-based delete
  # authz is already covered in `modelProvider.authz.integration.test.ts`.
  # Aspirational pending the delete-dialog harness.

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

  @integration @unimplemented
  Scenario: Show delete confirmation dialog
    Given I have "openai" provider enabled
    When I click the menu button for "openai" provider
    And I click "Delete Provider"
    Then I see a confirmation dialog
    And the dialog title is "Delete openai?"
    And the dialog warns that the provider and its stored API keys are permanently deleted

  @integration @unimplemented
  Scenario: Prevent deletion when provider used for Default Model
    Given I have "openai" provider enabled
    And the project's default model is "openai/gpt-4o"
    When I click the menu button for "openai" provider
    And I click "Delete Provider"
    Then I see a confirmation dialog
    And the dialog shows "This provider is currently being used for one or more default models and cannot be deleted."
    And the dialog lists "• Default Model" as a blocking reason
    And the "Delete" button is disabled

  @integration @unimplemented
  Scenario: Prevent deletion when provider used for Topic Clustering Model
    Given I have "openai" provider enabled
    And the project's topic clustering model is "openai/gpt-4o-mini"
    When I click the menu button for "openai" provider
    And I click "Delete Provider"
    Then I see a confirmation dialog
    And the dialog shows the provider cannot be deleted
    And the dialog lists "• Topic Clustering Model" as a blocking reason
    And the "Delete" button is disabled

  @integration @unimplemented
  Scenario: Prevent deletion when provider used for Embeddings Model
    Given I have "openai" provider enabled
    And the project's embeddings model is "openai/text-embedding-3-small"
    When I click the menu button for "openai" provider
    And I click "Delete Provider"
    Then I see a confirmation dialog
    And the dialog shows the provider cannot be deleted
    And the dialog lists "• Embeddings Model" as a blocking reason
    And the "Delete" button is disabled

  @integration @unimplemented
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

  @integration @unimplemented
  Scenario: Allow deletion when provider not used for defaults
    Given I have "openai" provider enabled
    And the project's default model is "anthropic/claude-sonnet-4"
    When I click the menu button for "openai" provider
    And I click "Delete Provider"
    Then I see a confirmation dialog
    And the dialog warns that the provider and its stored API keys are permanently deleted
    And the "Delete" button is enabled

  @integration @unimplemented
  Scenario: Successfully delete provider
    Given I have "openai" provider enabled
    And the provider is not used for any default models
    When I click the menu button for "openai" provider
    And I click "Delete Provider"
    And I confirm the deletion
    Then the provider is deleted
    And the provider no longer appears in the provider list
    And the dialog closes

  @integration @unimplemented
  Scenario: Cancel deletion
    Given I have "openai" provider enabled
    When I click the menu button for "openai" provider
    And I click "Delete Provider"
    And I click "Cancel"
    Then the dialog closes
    And the provider remains enabled
    And the provider still appears in the provider list

  @integration @unimplemented
  Scenario: Disable delete option without manage permission
    Given I do not have "project:manage" permission
    When I navigate to the Model Providers settings page
    Then the menu button for providers is disabled
    And a tooltip explains I need model provider manage permissions

  # ───────────────────────────────────────────────────────────────────────
  # Scope-aware deletion. The provider list shows credentials granted at the
  # organization, team, or sibling-project scope, but deletion used to look
  # the row up with a PROJECT-only scope filter — so an org-scoped provider
  # (e.g. a second "OpenAI" shown with a "LangWatch" org scope chip) 404'd
  # with "Model provider not found for this project". Deletion now resolves
  # the row by id within the caller's organization, gated by the existing
  # manage-all-scopes authz, and hard-deletes the row + its encrypted keys.
  # ───────────────────────────────────────────────────────────────────────

  @integration
  Scenario: Delete an organization-scoped provider from a project settings view
    Given an organization-scoped model provider in my organization
    And I am viewing model providers from a project in that organization
    When I delete that provider by id
    Then the provider row is removed
    And its scope grants are removed with it

  @integration
  Scenario: Delete a provider scoped only to a sibling project in the same org
    Given a model provider scoped only to a sibling project in my organization
    When I delete that provider by id from another project in the same org
    Then the provider row is removed

  @integration
  Scenario: Deleting a provider from a different organization is not found
    Given a model provider that belongs to a different organization
    When I attempt to delete it by id from my project
    Then the deletion is rejected as not found
    And the provider remains in the database

  @integration
  Scenario: Deleting a provider removes its stored credentials
    Given a model provider with stored API keys
    When I delete that provider
    Then no row with that provider id remains in the database
