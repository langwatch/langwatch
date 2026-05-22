Feature: Deploy Prompt Dialog
  As a LangWatch user
  I want a dialog to assign prompt versions to environment labels
  So that I can control which version is served in each environment from the UI

  # 1 scenario bound to llm-config-tag.repository.unit.test.ts (empty
  # getTagsForConfig). The remaining 2 @unimplemented are UPDATE per
  # AUDIT_MANIFEST.md: dialog-open description copy drifted (actual reads
  # "Use tags to get specific prompt versions via the SDK and API. Prompt
  # versions with the production tag are returned by default."), and the
  # method name is `getTagsForConfig` not `getLabelsForConfig`. Aspirational
  # pending UPDATE-class scenario rewrites tracked in PR #3458.

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

  @unit
  Scenario: Fetch all labels for a prompt config
    Given "pizza-prompt" has production=v2 and staging=v3
    When I call getLabelsForConfig with configId for "pizza-prompt"
    Then I receive two label records: production pointing to v2, staging pointing to v3

  @unit
  Scenario: getLabelsForConfig returns empty when no labels assigned
    Given "pizza-prompt" has no labels assigned
    When I call getLabelsForConfig with configId for "pizza-prompt"
    Then I receive an empty list

  # --- Layout ---

  @integration
  Scenario: Version Select inputs stay within the modal width
    Given I am on the prompt detail page for "pizza-prompt"
    And "pizza-prompt" has versions whose commit messages are long enough to overflow a 180px-wide trigger
    When I click the "Deploy" button
    Then each environment tag row (production, staging, any custom) renders within the modal's content boundary
    And the version Select trigger truncates long commit messages instead of pushing the row past the modal edge
