Feature: Custom labels in Deploy dialog
  As a LangWatch user
  I want to add custom labels (beyond production/staging) in the Deploy dialog
  So that I can manage environment-specific prompt versions for my team's workflow

  Background:
    Given I am logged into project "my-project"
    And a prompt "pizza-prompt" with versions v1, v2, v3

  # --- Backend: Custom label definitions ---
  # Label definitions are project-scoped (not org-scoped).

  @unit
  Scenario: Built-in labels are always available
    When I check the built-in label list
    Then "latest", "production", and "staging" are included
    And they are marked as built-in

  @integration
  Scenario: Creating a custom label definition
    When I create a label definition "canary" for the project
    Then a PromptLabel record exists with name "canary"
    And "canary" appears in the list of available labels

  @unit
  Scenario: Rejects label names starting with a number
    When I try to create a label named "123numeric"
    Then the operation fails with a validation error

  @unit
  Scenario: Rejects uppercase label names
    When I try to create a label named "UPPERCASE"
    Then the operation fails with a validation error

  @unit
  Scenario: Accepts a valid lowercase label name
    When I create a label named "canary"
    Then the operation succeeds

  @unit
  Scenario: Custom labels cannot shadow built-in labels
    When I try to create a label named "production"
    Then the operation fails because it conflicts with a built-in label

  @unit
  Scenario: Custom labels cannot shadow the "latest" pseudo-label
    When I try to create a label named "latest"
    Then the operation fails because it conflicts with a built-in label

  @integration
  Scenario: Deleting a custom label cascades to assignments
    Given "canary" is a custom label assigned to v2 of "pizza-prompt"
    When I delete the label definition "canary"
    Then the PromptLabel record for "canary" is removed
    And no PromptVersionLabel records reference "canary"

  # --- Backend: Assigning custom labels to versions ---

  @integration
  Scenario: Assigning a custom label to a version
    Given "canary" is a custom label for the project
    When I assign "canary" to v2 of "pizza-prompt"
    Then a PromptVersionLabel record exists with label "canary" pointing to v2

  @integration
  Scenario: Reassigning a custom label to a different version
    Given "canary" is a custom label assigned to v2 of "pizza-prompt"
    When I reassign "canary" to v3
    Then fetching with label "canary" returns v3

  @integration
  Scenario: Fetching with a custom label returns the labeled version
    Given "canary" is assigned to v2 of "pizza-prompt"
    When I fetch "pizza-prompt" with label "canary"
    Then I receive version v2

  @integration
  Scenario: Rejecting assignment of an undefined custom label
    When I try to assign "nonexistent" to v2 of "pizza-prompt"
    Then the operation fails with a validation error

  # --- Backend: Label listing for a prompt config ---

  @integration
  Scenario: Listing labels for a prompt config includes custom labels
    Given "production" is assigned to v1
    And "canary" is a custom label assigned to v2
    When I list labels for "pizza-prompt"
    Then I see "production" pointing to v1 and "canary" pointing to v2

  # --- UI: Deploy dialog shows labels ---

  @integration
  Scenario: Deploy dialog renders built-in and custom label rows
    Given "production" is assigned to v1
    And "canary" is a custom label assigned to v2
    When I open the Deploy dialog for "pizza-prompt"
    Then I see rows for "latest", "production", "staging", and "canary"
    And each row has a version selector

  @integration
  Scenario: Built-in labels have no delete button
    When I open the Deploy dialog for "pizza-prompt"
    Then the "latest" row has no delete button
    And the "production" row has no delete button
    And the "staging" row has no delete button

  @integration
  Scenario: Deploy dialog shows empty state when no custom labels exist
    When I open the Deploy dialog for "pizza-prompt"
    Then I see rows for "latest", "production", and "staging" only
    And the "+ Add label" button is visible

  # --- UI: Adding a custom label ---

  @integration
  Scenario: Deploy dialog adds a custom label row when user confirms input
    When I open the Deploy dialog for "pizza-prompt"
    And I click "+ Add label"
    And I type "canary" and confirm
    Then "canary" appears as a new row in the dialog with no version assigned

  @integration
  Scenario: Deploy dialog rejects duplicate custom label name
    Given "canary" is a custom label for the project
    When I open the Deploy dialog for "pizza-prompt"
    And I click "+ Add label"
    And I type "canary" and confirm
    Then the dialog shows an error that "canary" already exists

  # --- UI: Deleting a custom label ---

  @integration
  Scenario: Deploy dialog removes custom label row after delete confirmation
    Given "canary" is a custom label assigned to v2
    When I open the Deploy dialog for "pizza-prompt"
    And I click the delete button on "canary"
    Then a confirmation dialog warns that SDK callers may be affected
    When I confirm the deletion
    Then "canary" is removed from the dialog

  @integration
  Scenario: Custom label delete button is visible only for custom labels
    Given "canary" is a custom label assigned to v2
    When I open the Deploy dialog for "pizza-prompt"
    Then the "canary" row has a delete button
    And the "production" row has no delete button
