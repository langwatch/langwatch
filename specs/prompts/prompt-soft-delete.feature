Feature: Prompt soft-delete
  As a LangWatch user
  I want deleted prompts to be soft-deleted
  So that existing suites can still reference them and I understand why a target is unavailable

  # Both remaining @unimplemented scenarios are KEEP per AUDIT_MANIFEST.md:
  # the handle-nulling-on-delete logic that enables reuse is unit-tested in
  # llm-config.soft-delete.unit.test.ts, but no integration test exercises
  # the full create-with-reused-handle or post-archive CLI sync flow end-to-end.
  # Aspirational pending KEEP-class integration tests tracked in PR #3458.

  Background:
    Given I am logged into project "my-project"

  @integration
  Scenario: A user can reuse the handle of an archived prompt for a new prompt
    Given a prompt with handle "support-bot" exists
    And the prompt has been archived
    When I create a new prompt with handle "support-bot"
    Then the new prompt is available for use
    And it is independent of the archived prompt

  @integration
  Scenario: A user can sync a fresh prompt from the CLI after the previous one was archived
    Given a prompt with handle "greeter" has been archived
    When I sync a local prompt with handle "greeter" from the CLI
    Then the prompt is available after syncing
    And the CLI does not report any errors
