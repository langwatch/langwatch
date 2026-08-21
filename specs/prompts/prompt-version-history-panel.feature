# Prompt version history — read the list, and read the change
#
# Implementation:
#   platform/app/src/prompts/VersionHistoryListPopover.tsx                (the panel)
#   platform/app/src/prompts/version-history/promptVersionDiff.ts         (what changed between two versions)
#   platform/app/src/prompts/version-history/VersionChanges.tsx           (rendering of a change)
#   platform/app/src/prompts/components/SavePromptButton.tsx              (the save action's label)
#   platform/app/src/prompts/forms/SaveVersionDialog.tsx                  (the same label in the dialog)
#
# Related specs:
#   specs/prompts/prompt-version-history-author.feature   — who wrote a version
#   specs/prompts/prompt-version-detail-visibility.feature — the commit message shown in full
#
# Motivation: the panel answered "which versions exist" and nothing else. It
# never said WHEN a version was written, it could not say WHAT a version
# changed, and it spent its loudest element — a filled 48x44 tile — on the
# version number, the least informative thing in the row. The save button made
# the same mistake in words: "Update to v6" named the result of two different
# actions (saving edits, and republishing an old version) instead of naming
# either action.
#
# Decisions:
#   - Each row reads top to bottom as identity, intent, attribution: which
#     version and when, what the author said they did, who wrote it. The
#     version number is a quiet label, not a tile.
#   - Time is relative in the row, absolute on hover. A history is scanned for
#     recency; the exact moment matters rarely and costs a hover.
#   - Discarding unsaved edits is not a property of any version, so it leaves
#     the rows entirely and becomes a strip above the list. It sat next to the
#     current version only because that is the version it reverts to.
#   - The one action a row offers lives in the row's trailing overflow menu,
#     per dev/docs/best_practices/row-actions-overflow-menu.md. Loading a
#     version replaces what the editor holds, so one deliberate click is right.
#   - A version's diff is against the version immediately before it, because
#     that is the change the author actually made. The oldest version in the
#     list has no predecessor and offers no diff.
#   - Two versions can legitimately be identical: republishing an older version
#     as the latest copies its content forward. The panel says so rather than
#     showing an empty diff.
#   - The save button names the action, not the resulting version number. The
#     number survives as supporting detail on the button's tooltip and in the
#     save dialog.

Feature: Prompt version history panel
  As a LangWatch user reviewing a prompt's version history
  I want to see when each version was saved and what it changed
  So that I can pick the right version without opening every one of them

  Background:
    Given I am logged into project "my-project"
    And I am editing a prompt that has several saved versions

  @integration
  Scenario: Each version says when it was saved
    When I open the version history
    Then each version shows how long ago it was saved
    And hovering that time reveals the exact date and time

  @integration
  Scenario: The version the editor is on is marked as current
    Given I am editing version 2 of a prompt whose latest version is 3
    When I open the version history
    Then version 2 is marked "Current"
    And version 2 offers no action to load itself

  @integration
  Scenario: Loading another version is one deliberate choice
    Given I am editing the latest version of a prompt
    When I open the version history
    And I open the actions for an older version
    And I choose "Load this version"
    Then the editor is filled with that version's content

  @integration
  Scenario: Discarding unsaved edits is offered above the list, not beside a version
    Given I have edited the prompt without saving
    When I open the version history
    Then the panel tells me I have unsaved changes
    And it offers to discard them above the list of versions
    And no version row offers to discard them

  @integration
  Scenario: The panel is quiet when there is nothing unsaved
    Given I have made no edits since the prompt was last saved
    When I open the version history
    Then the panel does not offer to discard changes

  @integration
  Scenario: A version shows what it changed from the version before it
    Given version 3 rewrote the system prompt of version 2
    When I open the version history
    And I expand what changed in version 3
    Then I see the words version 3 removed and the words it added

  @integration
  Scenario: The oldest version offers no comparison
    When I open the version history
    Then the oldest version offers no way to expand what changed

  @unit
  Scenario: Changed model and temperature are reported as settings
    Given one version uses a different model and temperature from the version before it
    When the two versions are compared
    Then the comparison names the model change and the temperature change
    And it reports the value before and the value after each

  @unit
  Scenario: An added message is reported as added
    Given a version adds an assistant message the version before it did not have
    When the two versions are compared
    Then the comparison reports that message as added

  @unit
  Scenario: Two identical versions compare to nothing
    Given a version republishes the content of the version before it unchanged
    When the two versions are compared
    Then the comparison reports no changes

  @integration
  Scenario: The save button names saving, not the version number
    Given I have edited the prompt without saving
    Then the save button reads "Save changes"

  @integration
  Scenario: The save button names rollback when an older version is loaded
    Given I have loaded an older version and made no edits
    Then the save button offers to make that version the latest one

  @integration
  Scenario: The save button is quiet when there is nothing to save
    Given I am on the latest version and have made no edits
    Then the save button reads "Saved" and is disabled
