Feature: Deploy Prompt Dialog
  As a LangWatch user
  I want a dialog to assign prompt versions to environment labels
  So that I can control which version is served in each environment from the UI

  Background:
    Given I am logged into project "my-project"
    And a prompt "pizza-prompt" exists with versions v1, v2, v3, v4

  # --- Opening the dialog ---

  @integration
  Scenario: Open deploy dialog from prompt toolbar
    Given I am on the prompt detail page for "pizza-prompt"
    When I click the "Deploy" button
    Then I see the Deploy prompt dialog
    And the dialog title is "Deploy prompt"
    And the description reads "Assign prompt versions to environment labels. Default (no label) returns the latest version."
    And I see the prompt slug "pizza-prompt" with a copy button

  @integration
  Scenario: Dialog shows all label rows
    Given the Deploy dialog is open for "pizza-prompt"
    Then I see three label rows: latest, production, staging
    And the latest row shows the current version number
    And the latest row is not editable

  # --- Version dropdowns ---

  @integration
  Scenario: Version dropdown shows context
    Given the Deploy dialog is open for "pizza-prompt"
    When I open the production version dropdown
    Then I see entries with version number and commit message
    And versions are listed newest first

  @integration
  Scenario: Production and staging rows have version dropdowns
    Given the Deploy dialog is open for "pizza-prompt"
    Then the production row has a version dropdown
    And the staging row has a version dropdown

  # --- Assigning labels ---

  @integration
  Scenario: Assign production to a version
    Given the Deploy dialog is open for "pizza-prompt"
    And production is currently unassigned
    When I select v3 from the production dropdown
    And I click "Save changes"
    Then production is assigned to v3

  @integration
  Scenario: Change staging version
    Given the Deploy dialog is open for "pizza-prompt"
    And staging is currently assigned to v2
    When I change the staging dropdown to v3
    And I click "Save changes"
    Then staging is now assigned to v3

  # --- Backend query ---

  @integration
  Scenario: Fetch all labels for a prompt config
    Given "pizza-prompt" has production=v2 and staging=v3
    When I call getLabelsForConfig with configId for "pizza-prompt"
    Then I receive two label records: production pointing to v2, staging pointing to v3

  @unit
  Scenario: getLabelsForConfig returns empty when no labels assigned
    Given "pizza-prompt" has no labels assigned
    When I call getLabelsForConfig with configId for "pizza-prompt"
    Then I receive an empty list
