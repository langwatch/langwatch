Feature: Deploy Prompt Dialog
  As a LangWatch user
  I want a dialog to assign prompt versions to environment labels
  So that I can control which version is served in each environment from the UI

  Background:
    Given I am logged into project "my-project"
    And a prompt "pizza-prompt" exists with versions v1, v2, v3, v4

  # --- Opening the dialog ---

  @integration @unimplemented
  Scenario: Open deploy dialog from prompt toolbar
    Given I am on the prompt detail page for "pizza-prompt"
    When I click the "Deploy" button
    Then I see the Deploy prompt dialog
    And the dialog title is "Deploy prompt"
    And the description reads "Use tags to get specific prompt version via SDK. Prompt tagged as Production is returned by default."
    And I see the prompt slug "pizza-prompt" with a copy button

  @integration @unimplemented
  Scenario: Fetch all labels for a prompt config
    Given "pizza-prompt" has production=v2 and staging=v3
    When I call getLabelsForConfig with configId for "pizza-prompt"
    Then I receive two label records: production pointing to v2, staging pointing to v3

  @unit @unimplemented
  Scenario: getLabelsForConfig returns empty when no labels assigned
    Given "pizza-prompt" has no labels assigned
    When I call getLabelsForConfig with configId for "pizza-prompt"
    Then I receive an empty list
