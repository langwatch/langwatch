Feature: Prompt version tags
  As a LangWatch user
  I want to assign tags like "production" and "staging" to specific prompt versions
  So that I can control which version is served in each environment without changing code

  # All 3 remaining @unimplemented scenarios are KEEP/UPDATE per AUDIT_MANIFEST.md:
  # PromptTagAssignment record shape (UPDATE — old name was PromptVersionTag),
  # plus end-to-end ?tag=production / no-tag fetch via REST API (KEEP — service-
  # level tests exist in prompt-tags.integration.test.ts but no e2e on the
  # /api/prompts/:id endpoint with tag query). Aspirational pending UPDATE
  # rewording + KEEP REST-level tests tracked in PR #3458.

  Background:
    Given I am logged into project "my-project"

  # --- Assignment ---

  @integration
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
