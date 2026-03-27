Feature: Prompt labels
  As a LangWatch user
  I want to assign labels like "production" and "staging" to specific prompt versions
  So that I can control which version is served in each environment without changing code

  Background:
    Given I am logged into project "my-project"

  # --- Data Model ---

  @integration
  Scenario: Creating a label pointing to a specific version
    Given a prompt "pizza-prompt" with versions v1, v2, v3
    When I create a label "production" pointing to v2
    Then a label record exists with name "production" and versionId pointing to v2

  @unit
  Scenario: Label names are unique per prompt
    Given a prompt "pizza-prompt" with a label "production" pointing to v1
    When I try to create another label "production" on "pizza-prompt"
    Then the operation fails with a uniqueness error

  @integration
  Scenario: Labels are scoped to their own prompt
    Given a prompt "pizza-prompt" with a label "production" pointing to v2
    And a prompt "email-prompt" with a label "production" pointing to v5
    When I fetch the "production" label for "pizza-prompt"
    Then I receive version v2
    When I fetch the "production" label for "email-prompt"
    Then I receive version v5

  # --- Built-in Label Lifecycle ---

  @integration
  Scenario: Built-in labels are created with a new prompt
    When I create a new prompt "new-prompt"
    Then it has a "production" label pointing to v1
    And it has a "staging" label pointing to v1

  # --- Update ---

  @integration
  Scenario: Updating a label to point to a different version
    Given a prompt "pizza-prompt" with "production" pointing to v2
    When I update "production" to point to v3
    Then fetching with label "production" returns v3

  # --- Fetch by Label (API) ---

  @e2e
  Scenario: Fetching a prompt by label returns the labeled version
    Given "pizza-prompt" has production=v2, staging=v3
    When I call GET /api/prompts/pizza-prompt?label=production
    Then I receive version v2
    When I call GET /api/prompts/pizza-prompt?label=staging
    Then I receive version v3

  @e2e
  Scenario: Fetching a prompt without a label returns the latest version
    Given "pizza-prompt" has versions v1, v2, v3, v4
    When I call GET /api/prompts/pizza-prompt
    Then I receive version v4 (the highest version number)

  @integration
  Scenario: Fetching a prompt via tRPC with a label parameter
    Given "pizza-prompt" has production=v2, staging=v3
    When I call getByIdOrHandle with label "production"
    Then I receive version v2

  # --- CRUD ---

  @integration
  Scenario: Listing all labels for a prompt
    Given "pizza-prompt" has production=v2, staging=v3
    When I list labels for "pizza-prompt"
    Then I receive labels "production" and "staging"

  @integration
  Scenario: Deleting a custom label
    Given "pizza-prompt" has a custom label "canary" pointing to v3
    When I delete the "canary" label
    Then the label no longer exists

  # --- Error Handling ---

  @integration
  Scenario: Fetching with a nonexistent label returns an error
    Given a prompt "pizza-prompt" exists
    When I call GET /api/prompts/pizza-prompt?label=canary
    Then I receive a not-found error for label "canary"

  @unit
  Scenario: Label name must be a non-empty string
    When I try to create a label with an empty name
    Then the operation fails with a validation error

  @unit
  Scenario: Label must reference a valid version of the same prompt
    Given a prompt "pizza-prompt" with versions v1, v2
    When I try to create a label pointing to a version from a different prompt
    Then the operation fails with a validation error
