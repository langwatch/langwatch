Feature: Prompt soft-delete
  As a LangWatch user
  I want deleted prompts to be soft-deleted
  So that existing suites can still reference them and I understand why a target is unavailable

  Background:
    Given I am logged into project "my-project"

  @unit
  Scenario: Deleting a prompt marks it as deleted but preserves the record
    Given a prompt "Support Bot v2" exists
    When the prompt is deleted
    Then the prompt is no longer available but can still be referenced by existing suites
    And the prompt no longer appears in the prompts listing

  @integration
  Scenario: Archived prompt frees its handle so a new prompt can reuse it
    Given a prompt with handle "support-bot" exists
    And the prompt has been archived
    When I create a new prompt with handle "support-bot"
    Then the new prompt is created successfully
    And the new prompt has a different id from the archived one

  @integration
  Scenario: Syncing a new prompt works when a prior prompt with that handle was archived
    Given a prompt with handle "greeter" has been archived
    When I sync a local prompt with handle "greeter" from the CLI
    Then the sync action is "created"
    And the CLI exits with status 0
