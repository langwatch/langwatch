Feature: Prompt version tags
  As a LangWatch user
  I want to assign tags like "production" and "staging" to specific prompt versions
  So that I can control which version is served in each environment without changing code

  Background:
    Given I am logged into project "my-project"

  # --- Assignment ---

  @integration
  Scenario: Assigning a tag to a specific version
    Given a prompt "pizza-prompt" with versions v1, v2, v3
    When I assign "production" to v2
    Then a PromptVersionTag record exists with configId, tag "production", and versionId pointing to v2

  @integration
  Scenario: Reassigning a tag to a different version
    Given a prompt "pizza-prompt" with "production" assigned to v2
    When I reassign "production" to v3
    Then fetching with tag "production" returns v3

  @integration
  Scenario: Tags are scoped to their own prompt
    Given a prompt "pizza-prompt" with "production" assigned to v2
    And a prompt "email-prompt" with "production" assigned to v5
    When I fetch the "production" tag for "pizza-prompt"
    Then I receive version v2
    When I fetch the "production" tag for "email-prompt"
    Then I receive version v5

  # --- Hardcoded Tags ---

  @unit
  Scenario: Only production and staging are valid tags
    When I try to assign "canary" to a version
    Then the operation fails with a validation error
    When I assign "production" to a version
    Then the operation succeeds
    When I assign "staging" to a version
    Then the operation succeeds

  # --- Fetch by Tag ---

  @e2e
  Scenario: Fetching a prompt by tag returns the taged version
    Given "pizza-prompt" has production=v2, staging=v3
    When I call GET /api/prompts/pizza-prompt?tag=production
    Then I receive version v2
    When I call GET /api/prompts/pizza-prompt?tag=staging
    Then I receive version v3

  @e2e
  Scenario: Fetching a prompt without a tag returns the latest version
    Given "pizza-prompt" has versions v1, v2, v3, v4
    When I call GET /api/prompts/pizza-prompt
    Then I receive version v4 (the highest version number)

  @integration
  Scenario: Fetching a prompt via tRPC with a tag parameter
    Given "pizza-prompt" has production=v2, staging=v3
    When I call getByIdOrHandle with tag "production"
    Then I receive version v2

  # --- Mutual Exclusion ---

  @integration
  Scenario: Fetching with both version and tag is rejected
    Given a prompt "pizza-prompt" exists
    When I call getByIdOrHandle with both version and tag
    Then the operation fails with a bad request error

  # --- Error Handling ---

  @integration
  Scenario: Fetching with an unassigned tag returns an error
    Given a prompt "pizza-prompt" with no tags assigned
    When I call GET /api/prompts/pizza-prompt?tag=production
    Then I receive a not-found error for tag "production"

  @unit
  Scenario: Tag must reference a version belonging to the same prompt
    Given a prompt "pizza-prompt" with versions v1, v2
    When I try to assign "production" pointing to a version from a different prompt
    Then the operation fails with a validation error
