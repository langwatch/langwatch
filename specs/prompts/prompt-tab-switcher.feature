# Prompt playground tab switcher — reach any open prompt without scrolling
#
# Implementation:
#   langwatch/src/prompts/prompt-playground/components/prompt-browser/PromptPlaygroundBrowser.tsx  (switcher placement in the tab strip)
#   langwatch/src/prompts/prompt-playground/components/prompt-browser/ui/DraggableTabsBrowser.tsx  (tab strip compound component)
#   langwatch/src/prompts/prompt-playground/prompt-playground-store/DraggableTabsBrowserStore.ts   (windows -> tabs state)
#
# Related specs:
#   specs/traces-v2/lens-preset-groups.feature — the lens strip that solved the same
#     "strip ran out of room" problem; its overflow menu is the shared component reused here
#
# Motivation: opening several prompts fills the tab strip, and the extra tabs
# scroll off the right edge behind a fade gradient. Nothing tells the user those
# tabs exist, and the only way to reach one is to scroll the strip blindly.
#
# Decisions:
#   - The strip keeps scrolling. Tabs are never hidden, so drag-to-reorder keeps
#     working on every open tab.
#   - A switcher next to the strip lists every open prompt in that pane and
#     reports how many are open, so "more tabs exist" is visible at a glance.
#   - The switcher is per pane. Comparing two prompts side by side gives each
#     pane its own strip, so each pane gets its own switcher over its own tabs.
#   - Rows are a plain list. Filtering is deliberately deferred until the
#     unfiltered list is shown to hurt.
#   - A row mirrors what its tab shows: title, unsaved indicator, and the
#     version number when the tab is behind. A row never offers to upgrade or
#     close — those stay on the tab itself, so the switcher is purely navigation.

Feature: Prompt playground tab switcher

Rule: The switcher reports how many prompts are open

  Background:
    Given I am logged into project "my-project"
    And the prompt playground is open

  @integration
  Scenario: The switcher appears once a second prompt is open
    Given I have opened the prompts "summarizer" and "classifier"
    Then the tab switcher is shown
    And it reports that 2 prompts are open

  @integration
  Scenario: The switcher stays out of the way for a single prompt
    Given I have opened only the prompt "summarizer"
    Then the tab switcher is not shown

  @integration
  Scenario: The switcher is not shown when no prompt is open
    Given I have not opened any prompt
    Then the tab switcher is not shown

  @integration
  Scenario: Opening another prompt raises the count
    Given I have opened the prompts "summarizer" and "classifier"
    When I open the prompt "eval-judge"
    Then the tab switcher reports that 3 prompts are open

  @integration
  Scenario: Closing a prompt lowers the count
    Given I have opened the prompts "summarizer", "classifier", and "eval-judge"
    When I close the "classifier" tab
    Then the tab switcher reports that 2 prompts are open
    And the switcher no longer offers "classifier"

Rule: Selecting a prompt from the switcher activates and reveals it

  Background:
    Given I am logged into project "my-project"
    And I have opened more prompts than fit across the tab strip
    And "eval-judge" has scrolled out of view

  @integration
  Scenario: Choosing a prompt that has scrolled out of view
    When I open the tab switcher
    And I choose "eval-judge"
    Then "eval-judge" becomes the active prompt
    And its tab is scrolled into view in the strip

  @integration
  Scenario: The switcher marks which prompt is active
    Given "summarizer" is the active prompt
    When I open the tab switcher
    Then "summarizer" is shown as the active entry

  @integration
  Scenario: Choosing the already-active prompt changes nothing
    Given "summarizer" is the active prompt
    When I open the tab switcher
    And I choose "summarizer"
    Then "summarizer" remains the active prompt

Rule: A switcher row shows the same state as its tab

  Background:
    Given I am logged into project "my-project"
    And I have opened the prompts "summarizer" and "classifier"

  @integration
  Scenario: A row shows the prompt's title
    When I open the tab switcher
    Then a row is shown for "summarizer"
    And a row is shown for "classifier"

  @integration
  Scenario: A prompt that has never been saved shows a placeholder title
    Given I have created a new prompt that has not been saved
    When I open the tab switcher
    Then that row reads "New Prompt"

  @integration
  Scenario: A row marks a prompt with unsaved changes
    Given I have edited "summarizer" without saving
    When I open the tab switcher
    Then the "summarizer" row is marked as having unsaved changes
    And the "classifier" row is not

  @integration
  Scenario: Saving clears the unsaved marker from the row
    Given I have edited "summarizer" without saving
    When I save "summarizer"
    And I open the tab switcher
    Then the "summarizer" row is no longer marked as having unsaved changes

  @integration
  Scenario: A row shows the version only when the prompt is behind
    Given "summarizer" is open at a version older than the latest
    And "classifier" is open at the latest version
    When I open the tab switcher
    Then the "summarizer" row shows its version number
    And the "classifier" row shows no version number

  @integration
  Scenario: A row does not offer to close or upgrade the prompt
    Given "summarizer" is open at a version older than the latest
    When I open the tab switcher
    Then the "summarizer" row offers no upgrade action
    And the "summarizer" row offers no close action

Rule: Comparing prompts gives each pane its own switcher

  Background:
    Given I am logged into project "my-project"
    And I have opened the prompts "summarizer", "classifier", and "eval-judge"

  @integration
  Scenario: Splitting a prompt into a second pane splits the switchers
    When I compare "eval-judge" in a second pane
    Then the first pane's switcher reports that 2 prompts are open
    And the second pane's switcher is not shown, because a single prompt is there

  @integration
  Scenario: Each pane's switcher lists only that pane's prompts
    Given "eval-judge" has been compared into a second pane
    When I open "regression-check" and "tone-check" in the second pane
    Then the second pane's switcher reports that 3 prompts are open
    And the second pane's switcher offers "eval-judge", "regression-check", and "tone-check"
    And the second pane's switcher does not offer "summarizer"

Rule: The tab strip keeps its existing behaviour

  Background:
    Given I am logged into project "my-project"
    And I have opened more prompts than fit across the tab strip

  @integration
  Scenario: Tabs still scroll rather than disappear
    Then every open prompt still has a tab in the strip
    And the strip scrolls horizontally to reach them

  # Drag-reorder is exercised against a real pointer, not jsdom: @dnd-kit's
  # sensors depend on layout rects that jsdom does not compute. Verified by
  # hand against the running app, and tracked here so the invariant is not
  # silently lost when the switcher lands beside the strip.
  @e2e @unimplemented
  Scenario: Every open prompt can still be dragged to reorder
    When I drag the "eval-judge" tab before the "summarizer" tab
    Then "eval-judge" is ordered before "summarizer"
