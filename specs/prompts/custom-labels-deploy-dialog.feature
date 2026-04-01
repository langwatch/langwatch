Feature: Custom labels in Deploy dialog
  As a LangWatch user
  I want to add custom tags (beyond production/staging) in the Deploy dialog
  So that I can manage environment-specific prompt versions for my team's workflow

  Background:
    Given I am logged into project "my-project"
    And a prompt "pizza-prompt" with versions v1, v2, v3

  # --- Backend: Custom tag definitions ---
  # Tag definitions are organization-scoped.

  @unit
  Scenario: Built-in tags are always available
    When I check the built-in tag list
    Then "latest", "production", and "staging" are included
    And they are marked as built-in

  @integration
  Scenario: Creating a custom tag definition
    When I create a tag "canary" for the organization
    Then a PromptTag record exists with name "canary"
    And "canary" appears in the list of available tags

  @unit
  Scenario: Rejects tag names starting with a number
    When I try to create a tag named "123numeric"
    Then the operation fails with a validation error

  @unit
  Scenario: Rejects uppercase tag names
    When I try to create a tag named "UPPERCASE"
    Then the operation fails with a validation error

  @unit
  Scenario: Accepts a valid lowercase tag name
    When I create a tag named "canary"
    Then the operation succeeds

  @unit
  Scenario: Custom tags cannot shadow built-in tags
    When I try to create a tag named "production"
    Then the operation fails because it conflicts with a built-in tag

  @unit
  Scenario: Custom tags cannot shadow the "latest" pseudo-tag
    When I try to create a tag named "latest"
    Then the operation fails because it conflicts with a built-in tag

  @integration
  Scenario: Deleting a custom tag cascades to assignments
    Given "canary" is a custom tag assigned to v2 of "pizza-prompt"
    When I delete the tag "canary"
    Then the PromptTag record for "canary" is removed
    And no PromptVersionTag records reference "canary"

  # --- Backend: Assigning custom tags to versions ---

  @integration
  Scenario: Assigning a custom tag to a version
    Given "canary" is a custom tag for the organization
    When I assign "canary" to v2 of "pizza-prompt"
    Then a PromptVersionTag record exists with tag "canary" pointing to v2

  @integration
  Scenario: Reassigning a custom tag to a different version
    Given "canary" is a custom tag assigned to v2 of "pizza-prompt"
    When I reassign "canary" to v3
    Then fetching with tag "canary" returns v3

  @integration
  Scenario: Fetching with a custom tag returns the tagged version
    Given "canary" is assigned to v2 of "pizza-prompt"
    When I fetch "pizza-prompt" with tag "canary"
    Then I receive version v2

  @integration
  Scenario: Rejecting assignment of an undefined custom tag
    When I try to assign "nonexistent" to v2 of "pizza-prompt"
    Then the operation fails with a validation error

  # --- Backend: Tag listing for a prompt config ---

  @integration
  Scenario: Listing tags for a prompt config includes custom tags
    Given "production" is assigned to v1
    And "canary" is a custom tag assigned to v2
    When I list tags for "pizza-prompt"
    Then I see "production" pointing to v1 and "canary" pointing to v2

  # --- UI: Deploy dialog shows tags ---

  @integration
  Scenario: Deploy dialog renders built-in and custom tag rows
    Given "production" is assigned to v1
    And "canary" is a custom tag assigned to v2
    When I open the Deploy dialog for "pizza-prompt"
    Then I see rows for "latest", "production", "staging", and "canary"
    And each non-latest row has a version selector

  @integration
  Scenario: Only "latest" has no delete button
    When I open the Deploy dialog for "pizza-prompt"
    Then the "latest" row has no delete button
    And the "production" row has a delete button
    And the "staging" row has a delete button

  @integration
  Scenario: Deploy dialog shows empty state when no custom tags exist
    When I open the Deploy dialog for "pizza-prompt"
    Then I see rows for "latest", "production", and "staging" only
    And the "+ Add tag" button is visible

  # --- UI: Adding a custom tag ---

  @integration
  Scenario: Deploy dialog adds a custom tag row when user confirms input
    When I open the Deploy dialog for "pizza-prompt"
    And I click "+ Add tag"
    And I type "canary" and confirm
    Then "canary" appears as a new row in the dialog with no version assigned

  @integration
  Scenario: Deploy dialog rejects duplicate custom tag name
    Given "canary" is a custom tag for the organization
    When I open the Deploy dialog for "pizza-prompt"
    And I click "+ Add tag"
    And I type "canary" and confirm
    Then the dialog shows an error that "canary" already exists

  # --- UI: Deleting a custom tag ---

  @integration
  Scenario: Deploy dialog removes custom tag row after delete confirmation
    Given "canary" is a custom tag assigned to v2
    When I open the Deploy dialog for "pizza-prompt"
    And I click the delete button on "canary"
    Then a confirmation dialog warns that SDK callers may be affected
    When I confirm the deletion
    Then "canary" is removed from the dialog

  @integration
  Scenario: Custom tag delete button is visible only for non-latest tags
    Given "canary" is a custom tag assigned to v2
    When I open the Deploy dialog for "pizza-prompt"
    Then the "canary" row has a delete button
    And the "latest" row has no delete button
