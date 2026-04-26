Feature: Prompt version tags
  As a LangWatch user
  I want to assign tags like "production" and "staging" to specific prompt versions
  So that I can control which version is served in each environment without changing code

  Background:
    Given I am logged into project "my-project"

  # --- Assignment ---

  @integration @unimplemented
  Scenario: Assigning a tag to a specific version
    Given a prompt "pizza-prompt" with versions v1, v2, v3
    When I assign "production" to v2
    Then a PromptVersionTag record exists with configId, tag "production", and versionId pointing to v2

  @e2e @unimplemented
  Scenario: Fetching a prompt by tag returns the taged version
    Given "pizza-prompt" has production=v2, staging=v3
    When I call GET /api/prompts/pizza-prompt?tag=production
    Then I receive version v2
    When I call GET /api/prompts/pizza-prompt?tag=staging
    Then I receive version v3

  @e2e @unimplemented
  Scenario: Fetching a prompt without a tag returns the latest version
    Given "pizza-prompt" has versions v1, v2, v3, v4
    When I call GET /api/prompts/pizza-prompt
    Then I receive version v4 (the highest version number)
