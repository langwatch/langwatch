Feature: Prompt version history message detail
  As a LangWatch user reviewing a prompt's version history
  I want to see what actually happened in each version
  So that I don't have to guess or open every version to find out

  # Bound to:
  # - src/prompts/__tests__/VersionHistoryListPopover.test.tsx
  #   ("when a version's commit message is long")
  # - src/server/prompt-config/__tests__/describe-local-file-update.unit.test.ts
  # - src/server/prompt-config/__tests__/syncPrompt.unit.test.ts
  #   ("when syncing local changes without an explicit commit message")
  #
  # Previously the version list clamped every commit message to a single
  # line, so anything past the first few words was hidden behind an
  # ellipsis regardless of how descriptive the author had been. Separately,
  # syncing a prompt from a local file without an explicit commit message
  # always recorded the generic "Updated from local file", even though the
  # actual changed fields were already known internally.

  Background:
    Given I am logged into project "my-project"
    And I open the version history for a prompt

  @integration
  Scenario: A long commit message is shown in full
    Given a version has a commit message longer than a single line
    Then that version's commit message is shown in full, not cut off

  @integration
  Scenario: Syncing local changes without a commit message describes what changed
    Given a prompt is synced from a local file with no commit message provided
    And the local file changes the model and the temperature
    Then the recorded commit message names the fields that changed
