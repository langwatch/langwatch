# Lens System — Gherkin Spec
# Based on PRD-017: Lens System
# Covers: lens tabs UI, built-in lenses, creating lenses, draft state, editing custom lenses, persistence, data gating, keyboard shortcuts

# ─────────────────────────────────────────────────────────────────────────────
# LENS TABS UI
# ─────────────────────────────────────────────────────────────────────────────

Feature: Lens tab bar layout
  Lenses appear as tabs in the toolbar area above the table.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Tab bar renders below search bar and above the table
    When the Observe page loads
    Then the lens tab bar appears below the search bar
    And the lens tab bar appears above the trace table
    And the grouping selector and density toggle are on the same row as the tabs

  Scenario: Built-in lenses appear before custom lenses
    Given the user has a custom lens named "My Lens"
    When the Observe page loads
    Then the built-in lens tabs appear first in fixed order
    And the custom lens tab "My Lens" appears after the built-in tabs

  Scenario: Active tab has solid underline and bold text
    When the user clicks a lens tab
    Then the clicked tab shows a solid underline and bold text
    And all other tabs show muted text with no underline

  Scenario: Plus button appears at the far right of the tab bar
    When the Observe page loads
    Then a [+] button is visible at the far right of the tab bar

  Scenario: Tab bar scrolls horizontally when tabs overflow
    Given the user has many custom lenses that exceed the tab bar width
    When the Observe page loads
    Then the tab bar scrolls horizontally without wrapping
    And a subtle gradient fade on the right edge hints at more tabs

# ─────────────────────────────────────────────────────────────────────────────
# BUILT-IN LENSES
# ─────────────────────────────────────────────────────────────────────────────

Feature: Built-in lenses
  Phase 2 ships six built-in lenses that cannot be modified or deleted.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: All six built-in lenses are present
    When the Observe page loads
    Then the following built-in lens tabs are visible in order:
      | All Traces    |
      | Conversations |
      | Errors        |
      | By Model      |
      | By Service    |
      | By User       |

  Scenario: All Traces is the default lens
    When the Observe page loads
    Then the "All Traces" tab is active
    And the table shows traces in flat grouping with no default filters

  Scenario: Errors lens filters to error status
    When the user clicks the "Errors" tab
    Then the table shows only traces with status "error"

  Scenario: Conversations lens groups by session
    When the user clicks the "Conversations" tab
    Then the table groups traces by session
    And only traces with a conversation ID are shown
    And the grouping selector is locked

  Scenario: By Model lens groups by primary model
    When the user clicks the "By Model" tab
    Then the table groups traces by primary model
    And the grouping selector is locked

  Scenario: By Service lens groups by service name
    When the user clicks the "By Service" tab
    Then the table groups traces by service name
    And the grouping selector is locked

  Scenario: By User lens groups by user ID
    When the user clicks the "By User" tab
    Then the table groups traces by user ID
    And only traces with a user ID are shown
    And the grouping selector is locked

  Scenario: Built-in lenses cannot be renamed or deleted
    When the user right-clicks a built-in lens tab
    Then the context menu does not include "Rename", "Duplicate", or "Delete"

  Scenario: Built-in lens context menu offers save as new and reset
    When the user right-clicks a built-in lens tab
    Then the context menu shows "Save as new lens..."
    And the context menu shows "Reset to defaults"

  Scenario: Reset to defaults restores factory configuration on built-in lens
    Given the user changed columns on the "All Traces" built-in lens
    When the user right-clicks the "All Traces" tab and selects "Reset to defaults"
    Then the lens reverts to its default column set and filters

# ─────────────────────────────────────────────────────────────────────────────
# CREATING A LENS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Creating a custom lens
  Users create lenses to save a table configuration for reuse.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Plus button opens the save-as-lens popover
    When the user clicks the [+] button in the tab bar
    Then a "Save as lens" popover appears anchored below the [+] button
    And the name input is auto-focused
    And the name input is pre-filled with "Custom lens"

  Scenario: Save-as-new from custom lens context menu opens the popover
    Given the user has a custom lens named "My Lens"
    When the user right-clicks "My Lens" and selects "Save as new lens..."
    Then the "Save as lens" popover appears anchored below the "My Lens" tab

  Scenario: Save-as-new from built-in lens context menu opens the popover
    When the user right-clicks "All Traces" and selects "Save as new lens..."
    Then the "Save as lens" popover appears

  Scenario: Default name increments when name already exists
    Given the user has a custom lens named "Custom lens"
    When the user clicks the [+] button
    Then the name input is pre-filled with "Custom lens (2)"

  Scenario: Duplicate lens names are allowed
    Given the user has a custom lens named "Errors"
    When the user creates a new lens also named "Errors"
    Then both lenses exist with the name "Errors"

  Scenario: Empty name disables the save button
    When the user opens the save-as-lens popover
    And the user clears the name input
    Then the "Save lens" button is disabled
    And an inline hint reads "Name is required."

  Scenario: Enter key submits the lens
    When the user opens the save-as-lens popover
    And the user types a name and presses Enter
    Then the lens is saved

  Scenario: Escape key cancels the popover
    When the user opens the save-as-lens popover
    And the user presses Escape
    Then the popover closes without saving

  Scenario: New lens captures the current table state
    Given the user has configured columns, grouping, sort, filters, and conditional formatting
    When the user saves a new lens via the [+] button
    Then the new lens config includes the current visible columns and their order
    And the config includes current column widths
    And the config includes the current grouping mode
    And the config includes the current sort column and direction
    And the config includes active filters from the search bar and facets
    And the config includes active conditional formatting rules

  Scenario: New lens tab appears and becomes active after saving
    When the user saves a new lens named "My Analysis"
    Then a new tab "My Analysis" appears to the right of the last tab
    And the "My Analysis" tab becomes active
    And the tab does not show a draft dot

# ─────────────────────────────────────────────────────────────────────────────
# DRAFT STATE
# ─────────────────────────────────────────────────────────────────────────────

Feature: Draft state on custom lenses
  Custom lenses show a dot indicator when they have unsaved changes.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces
    And the user has a custom lens named "My Lens"

  Scenario: Modifying a custom lens shows the draft dot
    Given the "My Lens" tab is active
    When the user changes the sort column
    Then the tab label reads "My Lens" with a filled dot indicator

  Scenario: Draft dot appears for column changes
    Given the "My Lens" tab is active
    When the user reorders or hides a column
    Then the draft dot appears on the "My Lens" tab

  Scenario: Draft dot appears for grouping changes
    Given the "My Lens" tab is active
    When the user changes the grouping mode
    Then the draft dot appears on the "My Lens" tab

  Scenario: Draft dot appears for filter changes
    Given the "My Lens" tab is active
    When the user adds or removes a filter
    Then the draft dot appears on the "My Lens" tab

  Scenario: Draft dot appears for conditional formatting changes
    Given the "My Lens" tab is active
    When the user changes a conditional formatting rule
    Then the draft dot appears on the "My Lens" tab

  Scenario: Draft dot disappears when lens returns to saved state
    Given the "My Lens" tab has unsaved changes and shows the draft dot
    When the user reverts the changes to match the saved state
    Then the draft dot disappears

  Scenario: Draft dot is not clickable
    Given the "My Lens" tab shows the draft dot
    When the user clicks the dot
    Then nothing happens — no dropdown or action is triggered

  Scenario: Built-in lenses never show the draft dot
    Given the "All Traces" tab is active
    When the user changes filters or columns on the built-in lens
    Then the "All Traces" tab does not show a draft dot

  Scenario: Saving a custom lens removes the draft dot
    Given the "My Lens" tab has unsaved changes
    When the user right-clicks "My Lens" and selects "Save"
    Then the lens config is overwritten with the current state
    And the draft dot disappears

  Scenario: Reverting changes removes the draft dot
    Given the "My Lens" tab has unsaved changes
    When the user right-clicks "My Lens" and selects "Revert changes"
    Then the table reverts to the saved lens config
    And the draft dot disappears

  Scenario: Save and Revert are greyed out when there are no changes
    Given the "My Lens" tab has no unsaved changes
    When the user right-clicks the "My Lens" tab
    Then "Save" is greyed out
    And "Revert changes" is greyed out

# ─────────────────────────────────────────────────────────────────────────────
# DRAFT STATE: CONTEXT MENUS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Lens tab context menus
  Context menus provide draft actions and lens management options.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Custom lens context menu shows all actions
    Given the user has a custom lens named "My Lens"
    When the user right-clicks the "My Lens" tab
    Then the context menu shows the following items in order:
      | Save               |
      | Save as new lens...|
      | Revert changes     |
      | Rename...          |
      | Duplicate          |
      | Delete             |

  Scenario: Context menu opens via overflow button on hover
    Given the user has a custom lens named "My Lens"
    When the user hovers over the "My Lens" tab
    Then a "..." overflow button appears on the tab
    And clicking the overflow button opens the context menu

  Scenario: Save as new lens from context menu preserves original
    Given the user has a custom lens named "My Lens" with unsaved changes
    When the user right-clicks "My Lens" and selects "Save as new lens..."
    And the user saves a new lens named "My Lens v2"
    Then "My Lens" retains its original saved config
    And "My Lens v2" appears as a new tab with the current state

# ─────────────────────────────────────────────────────────────────────────────
# NAVIGATE AWAY: SILENT DISCARD
# ─────────────────────────────────────────────────────────────────────────────

Feature: Navigating away from a modified lens
  Switching tabs silently discards unsaved changes without confirmation.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Switching away from modified custom lens silently discards changes
    Given the user has a custom lens named "My Lens" with unsaved changes
    When the user clicks the "All Traces" tab
    Then "My Lens" reverts to its saved state
    And no confirmation dialog appears

  Scenario: Switching away from built-in lens resets ephemeral changes
    Given the user changed filters on the "Errors" built-in lens
    When the user clicks the "All Traces" tab
    Then the "Errors" lens resets any ephemeral filter and column changes

# ─────────────────────────────────────────────────────────────────────────────
# EDITING A CUSTOM LENS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Editing custom lenses
  Users can rename, duplicate, and delete custom lenses.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces
    And the user has a custom lens named "My Lens"

  Scenario: Renaming a custom lens via inline editing
    When the user right-clicks "My Lens" and selects "Rename..."
    Then the tab text becomes an editable inline input
    And the user types "Renamed Lens" and presses Enter
    Then the tab label reads "Renamed Lens"

  Scenario: Cancelling rename with Escape
    When the user right-clicks "My Lens" and selects "Rename..."
    And the user presses Escape
    Then the tab label remains "My Lens"

  Scenario: Duplicating a custom lens
    When the user right-clicks "My Lens" and selects "Duplicate"
    Then a new tab "My Lens (copy)" appears to the right
    And the new tab has the same config as "My Lens"

  Scenario: Deleting the active custom lens switches to All Traces
    Given the "My Lens" tab is active
    When the user right-clicks "My Lens" and selects "Delete"
    Then a confirmation dialog asks 'Delete "My Lens"?' with "This cannot be undone."
    And the dialog has "Cancel" and "Delete" buttons

  Scenario: Confirming delete removes the lens
    Given the user triggered delete on "My Lens" and the confirmation dialog is showing
    When the user clicks "Delete"
    Then the "My Lens" tab is removed
    And the "All Traces" tab becomes active

  Scenario: Cancelling delete keeps the lens
    Given the user triggered delete on "My Lens" and the confirmation dialog is showing
    When the user clicks "Cancel"
    Then the "My Lens" tab remains

# ─────────────────────────────────────────────────────────────────────────────
# PERSISTENCE
# ─────────────────────────────────────────────────────────────────────────────

Feature: Lens persistence in localStorage
  Custom lenses are stored in localStorage scoped to the project.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Custom lenses are stored in localStorage by project
    When the user creates a custom lens
    Then the lens config is saved to localStorage under key "langwatch:lenses:{projectId}"
    And the stored format is a JSON array of LensConfig objects

  Scenario: Built-in lenses are not stored in localStorage
    When the user views the localStorage key "langwatch:lenses:{projectId}"
    Then no built-in lens configs are present

  Scenario: Column overrides on built-in lenses are stored separately
    Given the user changed column widths on the "All Traces" built-in lens
    Then the override is stored under key "langwatch:lensOverrides:{projectId}"
    And the override is a map of lens ID to partial LensConfig

  Scenario: Resetting a built-in lens clears its override
    Given the user has column overrides on the "All Traces" built-in lens
    When the user right-clicks "All Traces" and selects "Reset to defaults"
    Then the override for "All Traces" is removed from localStorage

  Scenario: Save-as-lens popover indicates browser-only storage
    When the user opens the save-as-lens popover
    Then the popover displays "Saved to this browser"

  Scenario: Custom lenses persist across page refreshes
    Given the user has a custom lens named "Persistent Lens"
    When the user refreshes the page
    Then the "Persistent Lens" tab is still visible with its saved config

# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Feature: Data gating and edge cases
  The lens system handles missing data, corruption, and storage limits gracefully.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: No custom lenses shows only built-in tabs with plus button
    Given no custom lenses exist
    When the Observe page loads
    Then only built-in lens tabs are shown
    And the [+] button is visible

  Scenario: Many custom lenses cause horizontal scrolling
    Given the user has more than 10 custom lenses
    When the Observe page loads
    Then the tab bar scrolls horizontally to accommodate all tabs

  Scenario: Corrupted localStorage resets to built-in lenses
    Given the localStorage lens data is corrupted and cannot be parsed
    When the Observe page loads
    Then only built-in lenses are shown
    And a warning is logged to the console

  Scenario: Storage quota exceeded shows a toast
    Given the browser localStorage is full
    When the user tries to save a custom lens
    Then a non-blocking toast reads "Could not save lens. Browser storage full."
    And the lens remains in memory until the page is refreshed
    And a warning is logged to the console

  Scenario: Lens referencing a deleted column silently removes it
    Given a custom lens includes a column that no longer exists
    When the lens is loaded
    Then the deleted column is silently removed from the lens config
    And the lens renders with the remaining columns

# ─────────────────────────────────────────────────────────────────────────────
# KEYBOARD SHORTCUTS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Lens keyboard shortcuts
  Users can switch lenses with keyboard shortcuts.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Cmd/Ctrl + number switches to lens by position
    Given there are at least 3 lens tabs
    When the user presses Cmd+2 (or Ctrl+2 on non-Mac)
    Then the second lens tab becomes active

  Scenario: Cmd/Ctrl + number supports positions 1 through 9
    Given there are 9 or more lens tabs
    When the user presses Cmd+9
    Then the ninth lens tab becomes active

  Scenario: Right-click on a custom lens tab opens context menu
    Given the user has a custom lens named "My Lens"
    When the user right-clicks the "My Lens" tab
    Then the context menu opens with lens management options
