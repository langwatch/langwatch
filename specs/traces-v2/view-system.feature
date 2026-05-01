# Lens System — Gherkin Spec
# Covers: lens tabs UI, built-in lenses, creating lenses, draft state, editing custom lenses, persistence, data gating, keyboard shortcuts
#
# Audited against `langwatch/src/features/traces-v2/{stores/viewStore.ts,components/Toolbar/*}`
# on 2026-05-01. Scenarios that describe behavior the current code doesn't implement
# are tagged `@planned`.

# ─────────────────────────────────────────────────────────────────────────────
# LENS TABS UI
# ─────────────────────────────────────────────────────────────────────────────

Feature: Lens system

Rule: Lens tab bar layout
  Lenses appear as tabs in the toolbar area above the table.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Tab bar renders above the table
    When the Observe page loads
    Then the lens tab bar appears above the trace table
    And the grouping selector and density toggle are on the same row as the tabs

  Scenario: Built-in lenses appear before custom lenses
    Given the user has a custom lens named "My Lens"
    When the Observe page loads
    Then the built-in lens tabs appear first in fixed order
    And the custom lens tab "My Lens" appears after the built-in tabs

  Scenario: Active tab uses the Chakra "line" Tabs underline
    When the user clicks a lens tab
    Then the clicked tab is rendered as the active Chakra Tabs trigger with the orange palette underline
    And all other tabs render in their inactive state

  Scenario: Plus button appears immediately after the last tab
    When the Observe page loads
    Then a [+] button is visible inside the tab scroller, directly to the right of the last tab

  Scenario: Tabs that overflow the toolbar collapse into an overflow menu
    Given the user has many custom lenses that exceed the tab bar width
    When the Observe page loads
    Then tabs that don't fit are hidden from the bar
    And a "..." overflow trigger appears at the end of the tab area, opening a menu listing the hidden lenses
    And the active tab is always kept visible (a visible tab is hidden in its place if needed)

# ─────────────────────────────────────────────────────────────────────────────
# BUILT-IN LENSES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Built-in lenses
  The current build ships six built-in lenses. They are immutable from the
  user's perspective: edits are tracked locally as drafts but cannot overwrite
  the lens definition.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: All six built-in lenses are present
    When the Observe page loads
    Then the following built-in lens tabs are visible in order:
      | All            |
      | Conversations  |
      | Errors         |
      | Slow requests  |
      | Quality review |
      | By Model       |

  Scenario: All is the default lens
    When the Observe page loads
    Then the "All" tab is active
    And the table shows traces in flat grouping with no default filters

  Scenario: Errors lens filters to error status
    When the user clicks the "Errors" tab
    Then the saved filter "status:error" is applied so only error traces are shown

  Scenario: Conversations lens groups by conversation
    When the user clicks the "Conversations" tab
    Then the table groups traces by conversation (grouping mode "by-conversation")
    And only traces with a conversation ID are shown
    And the active grouping reflects the lens's saved value

  Scenario: By Model lens groups by primary model
    When the user clicks the "By Model" tab
    Then the table groups traces by primary model (grouping mode "by-model")
    And the active grouping reflects the lens's saved value

  @planned
  # By Service / By User built-ins do not exist in the current build, but the
  # `by-service` and `by-user` grouping modes are available via the grouping
  # selector or as a custom lens.
  Scenario: Dedicated "By Service" and "By User" built-in lenses
    When the Observe page loads
    Then dedicated "By Service" and "By User" built-in lens tabs are visible

  Scenario: Built-in lens context menu shows the immutable-lens actions
    When the user right-clicks a built-in lens tab
    Then the context menu shows "Save as new lens…"
    And the context menu shows "Revert local changes" (disabled when there are no drafts)
    And the context menu shows "Delete" (disabled when fewer than two lenses remain)
    And the menu does NOT include "Save", "Rename", "Duplicate", or "Reset to defaults"

  Scenario: Reverting a built-in lens with local edits clears the draft
    Given the user changed columns on the "All" built-in lens
    When the user right-clicks the "All" tab and selects "Revert local changes"
    Then the lens reverts to its saved column set, grouping, sort, and filter
    And the orange draft dot disappears from the tab

# ─────────────────────────────────────────────────────────────────────────────
# CREATING A LENS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Creating a custom lens
  Users create lenses to save a table configuration for reuse.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Plus button opens the create-lens popover
    When the user clicks the [+] button in the tab bar
    Then a popover appears with a "Lens name" input, a "Create" button, and a "Configure columns, sort, and more…" link
    And the name input is auto-focused
    And the name input is empty by default

  Scenario: Save-as-new from a custom lens context menu uses a window.prompt
    Given the user has a custom lens named "My Lens"
    When the user right-clicks "My Lens" and selects "Save as new lens…"
    Then the browser shows a `window.prompt` dialog seeded with "My Lens (copy)"

  Scenario: Save-as-new from a built-in lens context menu uses a window.prompt
    When the user right-clicks "All" and selects "Save as new lens…"
    Then the browser shows a `window.prompt` dialog seeded with "All (copy)"

  Scenario: Duplicate lens names are allowed
    Given the user has a custom lens named "Errors"
    When the user creates a new lens also named "Errors"
    Then both lenses exist with the name "Errors"

  Scenario: Empty name disables the Create button
    When the user opens the create-lens popover
    Then the "Create" button is disabled while the trimmed name is empty

  Scenario: Enter key submits the lens
    When the user opens the create-lens popover
    And the user types a name and presses Enter
    Then the lens is saved

  Scenario: Escape key cancels the popover
    When the user opens the create-lens popover
    And the user presses Escape
    Then the popover closes without saving

  Scenario: New lens captures the current table state
    Given the user has configured columns, grouping, sort, and a search-bar filter
    When the user saves a new lens via the [+] button (quick-create path)
    Then the new lens config includes the current visible columns and their order
    And the config includes the current grouping mode
    And the config includes the current sort column and direction
    And the config's `filterText` is the current search-bar query
    But column widths are NOT persisted in the lens config (they live in the separate column-sizing store)

  @planned
  # Lens config does not yet have a `conditionalFormatting` field, so the
  # quick-create snapshot cannot include formatting rules.
  Scenario: New lens snapshot also captures conditional formatting rules
    Given the user has configured conditional formatting on at least one column
    When the user saves a new lens via the [+] button
    Then the new lens config includes the active conditional formatting rules

  Scenario: Configure dialog path captures explicit columns/grouping/sort/addons
    When the user clicks "Configure columns, sort, and more…" in the popover
    Then the LensConfigDialog opens seeded with the current view state
    And submitting the dialog creates a lens using the dialog's explicit values (columns, addons, grouping, sort, filterText)

  Scenario: New lens tab appears and becomes active after saving
    When the user saves a new lens named "My Analysis"
    Then a new tab "My Analysis" appears to the right of the last existing tab
    And the "My Analysis" tab becomes active
    And the tab does not show a draft dot

# ─────────────────────────────────────────────────────────────────────────────
# DRAFT STATE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Draft state on lenses
  Lenses are immutable from the user's perspective: edits are stored as a
  per-lens local "draft" overlay (sort / grouping / columns / filter) that the
  active session reads. Both built-in and custom lens tabs show an orange dot
  when a draft is present.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces
    And the user has a custom lens named "My Lens"

  Scenario: Modifying a custom lens shows the draft dot
    Given the "My Lens" tab is active
    When the user changes the sort column
    Then the tab renders an orange filled dot next to the lens name

  Scenario: Draft dot appears for column changes
    Given the "My Lens" tab is active
    When the user reorders, hides, or shows a column
    Then the draft dot appears on the "My Lens" tab

  Scenario: Draft dot appears for grouping changes
    Given the "My Lens" tab is active
    When the user changes the grouping mode
    Then the draft dot appears on the "My Lens" tab

  Scenario: Draft dot appears for filter changes
    Given the "My Lens" tab is active
    When the user changes the search-bar filter so it differs from the lens's saved `filterText`
    Then the draft dot appears on the "My Lens" tab

  @planned
  # Conditional formatting is not yet wired into LensConfig or the draft store.
  Scenario: Draft dot appears for conditional formatting changes
    Given the "My Lens" tab is active
    When the user changes a conditional formatting rule
    Then the draft dot appears on the "My Lens" tab

  Scenario: Draft dot disappears when the filter is reverted to the saved value
    Given the "My Lens" tab has unsaved changes only on the search-bar filter
    When the user edits the search bar so it again equals the saved `filterText`
    Then the filter draft entry is cleared and the dot disappears (if no other draft fields remain)

  Scenario: Built-in lenses also show the draft dot when edited
    Given the "All" tab is active
    When the user changes columns, grouping, sort, or the filter on the built-in lens
    Then the "All" tab shows the orange draft dot
    # Built-ins can't be saved into localStorage — the menu only exposes
    # "Save as new lens…" / "Revert local changes" / "Delete".

  Scenario: Double-clicking a dirty tab reverts its draft
    Given the "My Lens" tab has unsaved changes and shows the draft dot
    When the user double-clicks the "My Lens" tab
    Then the lens reverts to its saved config and the draft dot disappears

  @planned
  # The current build does not have a "Save" (overwrite) action. Lenses are
  # immutable; users keep changes by saving as a new lens.
  Scenario: Save (overwrite) action on the context menu
    Given the "My Lens" tab has unsaved changes
    When the user right-clicks "My Lens" and selects "Save"
    Then the lens config is overwritten with the current state
    And the draft dot disappears

  Scenario: Reverting changes via the menu removes the draft dot
    Given the "My Lens" tab has unsaved changes
    When the user right-clicks "My Lens" and selects "Revert local changes"
    Then the table reverts to the saved lens config
    And the draft dot disappears

  Scenario: Revert is greyed out when there are no unsaved changes
    Given the "My Lens" tab has no unsaved changes
    When the user right-clicks the "My Lens" tab
    Then "Revert local changes" is disabled

# ─────────────────────────────────────────────────────────────────────────────
# DRAFT STATE: CONTEXT MENUS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Lens tab context menus
  Context menus provide draft actions and lens management options.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Custom lens context menu items
    Given the user has a custom lens named "My Lens"
    When the user right-clicks the "My Lens" tab
    Then the context menu shows the following items in order:
      | Save as new lens…    |
      | Revert local changes |
      | Rename               |
      | Duplicate            |
      | Delete               |
    And the menu does NOT include a "Save" (overwrite) action

  Scenario: Save-as-new label changes when the lens is dirty
    Given the user has a custom lens named "My Lens" with unsaved changes
    When the user right-clicks the "My Lens" tab
    Then the first menu item reads "Save changes as new lens…" (instead of "Save as new lens…")

  @planned
  # Tabs use a right-click / `MenuContextTrigger` only — there is no per-tab
  # hover-triggered "..." overflow button. The "..." control next to the tabs
  # is the lens-bar overflow trigger for hidden tabs, not a per-tab menu.
  Scenario: Per-tab overflow ("...") button on hover
    Given the user has a custom lens named "My Lens"
    When the user hovers over the "My Lens" tab
    Then a "..." overflow button appears on the tab
    And clicking the overflow button opens the context menu

  Scenario: Save as new lens preserves the original
    Given the user has a custom lens named "My Lens" with unsaved changes
    When the user right-clicks "My Lens" and selects "Save as new lens…"
    And the user enters "My Lens v2" in the prompt
    Then "My Lens" retains its original saved config (drafts stay local on it)
    And "My Lens v2" appears as a new tab carrying the current view state

# ─────────────────────────────────────────────────────────────────────────────
# NAVIGATE AWAY: UNSAVED-LENS DIALOG
# ─────────────────────────────────────────────────────────────────────────────

Rule: Navigating away from a modified custom lens
  Switching away from a dirty custom lens opens the UnsavedLensDialog so the
  user can choose between Save-as-new, Discard, and Cancel. Drafts on the
  lens are also persisted to localStorage so a refresh keeps the changes.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Switching away from a modified custom lens opens the unsaved-lens dialog
    Given the user has a custom lens named "My Lens" with unsaved changes
    When the user clicks the "All" tab
    Then the UnsavedLensDialog opens with "Save as new lens…", "Discard", and "Cancel" buttons
    And the dialog body references "My Lens" by name

  Scenario: Discarding from the unsaved-lens dialog reverts and switches
    Given the UnsavedLensDialog is open with "All" pending
    When the user clicks "Discard"
    Then the draft on "My Lens" is cleared and the active tab switches to "All"

  Scenario: Save-as-new from the unsaved-lens dialog keeps changes and stays on the new lens
    Given the UnsavedLensDialog is open with "All" pending
    When the user clicks "Save as new lens…" and enters a name
    Then a new lens is created from the current view state and becomes active
    And the originally pending switch to "All" is cancelled

  Scenario: Cancelling the unsaved-lens dialog leaves everything as-is
    Given the UnsavedLensDialog is open
    When the user clicks "Cancel" or closes the dialog
    Then the active lens stays the same and its draft is preserved

  Scenario: Switching away from a dirty built-in lens does NOT open the dialog
    Given the user changed filters on the "Errors" built-in lens
    When the user clicks the "All" tab
    Then the active tab switches immediately without a confirmation dialog
    But the draft on "Errors" is preserved (the orange dot stays on it; clicking back restores those edits)

# ─────────────────────────────────────────────────────────────────────────────
# EDITING A CUSTOM LENS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Editing custom lenses
  Users can rename, duplicate, and delete custom lenses.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces
    And the user has a custom lens named "My Lens"

  Scenario: Renaming a custom lens via inline editing
    When the user right-clicks "My Lens" and selects "Rename"
    Then the tab text becomes an editable inline input
    When the user types "Renamed Lens" and presses Enter
    Then the tab label reads "Renamed Lens"

  Scenario: Cancelling rename with Escape
    When the user right-clicks "My Lens" and selects "Rename"
    And the user presses Escape
    Then the tab label remains "My Lens"

  Scenario: Duplicating a custom lens
    When the user right-clicks "My Lens" and selects "Duplicate"
    Then a new tab "My Lens (copy)" appears as the last tab
    And the new lens has the same saved config as "My Lens" (drafts on the original are NOT carried over)
    And the duplicate immediately becomes the active tab

  Scenario: Deleting the active lens switches to the first remaining lens
    Given the "My Lens" tab is active
    When the user right-clicks "My Lens" and selects "Delete"
    Then the "My Lens" tab is removed without a confirmation dialog
    And the first remaining lens (e.g. "All") becomes active
    # The current implementation does not show a confirmation dialog for delete.

  Scenario: Delete is disabled when only one lens remains
    Given the user has dismissed all but one lens
    When the user right-clicks the remaining lens
    Then the "Delete" menu item is disabled

  @planned
  # Delete currently fires immediately. A confirmation dialog with
  # "Cancel" / "Delete" buttons has not been implemented.
  Scenario: Deleting a custom lens shows a confirmation dialog
    Given the "My Lens" tab is active
    When the user right-clicks "My Lens" and selects "Delete"
    Then a confirmation dialog asks 'Delete "My Lens"?' with "Cancel" and "Delete" buttons

# ─────────────────────────────────────────────────────────────────────────────
# PERSISTENCE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Lens persistence in localStorage
  Lens state spans three localStorage keys (all global, NOT project-scoped in
  the current build):
    - `langwatch:traces-v2:lenses:v2`             — array of custom LensConfig
    - `langwatch:traces-v2:drafts:v1`             — map of lensId → draft overlay
    - `langwatch:traces-v2:dismissed-builtins:v1` — array of dismissed built-in ids

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Custom lenses are stored in localStorage
    When the user creates a custom lens
    Then the lens config is saved to localStorage under key "langwatch:traces-v2:lenses:v2"
    And the stored format is a JSON array of LensConfig objects

  @planned
  # Lens storage keys are not yet project-scoped; switching projects in the
  # same browser shares the lens list.
  Scenario: Custom lenses are scoped to the project in storage
    When the user creates a custom lens in project A
    Then the lens is stored under a project-A-scoped localStorage key and not visible from project B

  Scenario: Built-in lenses are not stored in the lenses key
    When the user inspects "langwatch:traces-v2:lenses:v2"
    Then only the user's custom lenses are present (built-ins are hard-coded)

  Scenario: Local edits to a built-in lens are stored in the drafts key
    Given the user changed columns on the "All" built-in lens
    Then the draft is stored under key "langwatch:traces-v2:drafts:v1"
    And the entry is a map from lens id to a partial { sort?, grouping?, columns?, filter? }

  Scenario: Reverting a built-in lens clears its draft entry
    Given the user has draft column changes on the "All" built-in lens
    When the user right-clicks "All" and selects "Revert local changes"
    Then the draft entry for "all-traces" is removed from "langwatch:traces-v2:drafts:v1"

  Scenario: Deleting a built-in lens persists the dismissal
    When the user deletes a built-in lens (only allowed when more than one lens exists)
    Then its id is appended to "langwatch:traces-v2:dismissed-builtins:v1"
    And it does not reappear on next page load

  Scenario: Create-lens popover surfaces a beta-storage hint
    When the user opens the create-lens popover via the [+] button
    Then the popover footer reads "Saved locally during beta — won't sync across browsers yet."
    And the [+] button itself has a tooltip: "Lenses are saved in your browser during this beta — they don't sync across browsers or teammates yet."

  Scenario: Custom lenses persist across page refreshes
    Given the user has a custom lens named "Persistent Lens"
    When the user refreshes the page
    Then the "Persistent Lens" tab is still visible with its saved config

# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Data gating and edge cases
  The lens system handles missing data, corruption, and storage limits gracefully.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: No custom lenses shows only built-in tabs with plus button
    Given no custom lenses exist
    When the Observe page loads
    Then only built-in lens tabs are shown
    And the [+] button is visible

  Scenario: Many custom lenses overflow into a "..." menu
    Given the user has many custom lenses that exceed the available toolbar width
    When the Observe page loads
    Then tabs that don't fit are hidden and surfaced via a "..." overflow menu

  Scenario: Corrupted localStorage falls back to an empty custom-lens list
    Given "langwatch:traces-v2:lenses:v2" contains data that cannot be parsed
    When the Observe page loads
    Then only built-in lenses are shown (custom-lens loader silently returns [])

  @planned
  # On a quota error the persistence helpers swallow the failure silently;
  # there is no user-facing toast or console warning today.
  Scenario: Storage quota exceeded shows a toast
    Given the browser localStorage is full
    When the user tries to save a custom lens
    Then a non-blocking toast reads "Could not save lens. Browser storage full."
    And the lens remains in memory until the page is refreshed

  @planned
  # The legacy custom-lens loader does NOT yet reconcile saved lenses against
  # the current capability descriptors when reading from storage. (The rich
  # config dialog reconciles its own draft via `reconcileColumns`, but a
  # restored lens with an unknown column id is rendered as-is — the cell
  # registry then renders nothing for the unknown id.)
  Scenario: Lens referencing a deleted column silently removes it
    Given a custom lens includes a column that no longer exists
    When the lens is loaded
    Then the deleted column is silently removed from the lens config

  Scenario: Lens with a stale `by-session` grouping migrates to `by-conversation`
    Given a stored lens has grouping "by-session" (legacy value)
    When the lens is loaded
    Then its grouping is rewritten to "by-conversation" before being added to the active set

# ─────────────────────────────────────────────────────────────────────────────
# KEYBOARD AND MOUSE INTERACTIONS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Lens-related interactions
  Lens tabs respond to right-click and double-click; there is no per-lens
  numeric shortcut today.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  @planned
  # `useKeyboardShortcuts` registers `[`, `D`, `?`, Cmd/Ctrl+F, and Escape;
  # there is no Cmd/Ctrl+digit handler for switching lenses.
  Scenario: Cmd/Ctrl + number switches to lens by position
    Given there are at least 3 lens tabs
    When the user presses Cmd+2 (or Ctrl+2 on non-Mac)
    Then the second lens tab becomes active

  Scenario: Right-click on a lens tab opens its context menu
    Given the user has a custom lens named "My Lens"
    When the user right-clicks the "My Lens" tab
    Then the context menu opens with lens management options

  Scenario: Double-clicking a dirty lens reverts its local changes
    Given the "My Lens" tab is active and shows the orange draft dot
    When the user double-clicks the "My Lens" tab
    Then `revertLens(lensId)` runs and the draft is cleared
