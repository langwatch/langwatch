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
