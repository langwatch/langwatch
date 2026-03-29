Feature: Prompt version labels
  As a LangWatch user
  I want to assign labels like "production" and "staging" to specific prompt versions
  So that I can control which version is served in each environment without changing code

  Background:
    Given I am logged into project "my-project"

  # --- Assignment ---

  @integration
  Scenario: Assigning a label to a specific version
    Given a prompt "pizza-prompt" with versions v1, v2, v3
    When I assign "production" to v2
    Then a PromptVersionLabel record exists with configId, label "production", and versionId pointing to v2

  @integration
  Scenario: Reassigning a label to a different version
    Given a prompt "pizza-prompt" with "production" assigned to v2
    When I reassign "production" to v3
    Then fetching with label "production" returns v3

  @integration
  Scenario: Labels are scoped to their own prompt
    Given a prompt "pizza-prompt" with "production" assigned to v2
    And a prompt "email-prompt" with "production" assigned to v5
    When I fetch the "production" label for "pizza-prompt"
    Then I receive version v2
    When I fetch the "production" label for "email-prompt"
    Then I receive version v5

  # --- Hardcoded Labels ---

  @unit
  Scenario: Only production and staging are valid labels
    When I try to assign "canary" to a version
    Then the operation fails with a validation error
    When I assign "production" to a version
    Then the operation succeeds
    When I assign "staging" to a version
    Then the operation succeeds

  # --- Fetch by Label ---

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

  # --- Mutual Exclusion ---

  @integration
  Scenario: Fetching with both version and label is rejected
    Given a prompt "pizza-prompt" exists
    When I call getByIdOrHandle with both version and label
    Then the operation fails with a bad request error

  # --- Error Handling ---

  @integration
  Scenario: Fetching with an unassigned label returns an error
    Given a prompt "pizza-prompt" with no labels assigned
    When I call GET /api/prompts/pizza-prompt?label=production
    Then I receive a not-found error for label "production"

  @unit
  Scenario: Label must reference a version belonging to the same prompt
    Given a prompt "pizza-prompt" with versions v1, v2
    When I try to assign "production" pointing to a version from a different prompt
    Then the operation fails with a validation error
