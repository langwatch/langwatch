# Column Configuration — Gherkin Spec
# Based on PRD-018: Column Configuration
# Covers: column visibility, drag-to-reorder, column resize, lens state persistence, defaults, data gating

# ─────────────────────────────────────────────────────────────────────────────
# COLUMN VISIBILITY
# ─────────────────────────────────────────────────────────────────────────────

Feature: Column visibility toggle
  Users show or hide columns via the Columns dropdown to customize the trace table.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a lens is active with default columns visible

  Scenario: Columns button opens a dropdown with checkboxes
    When the user clicks the Columns button
    Then a dropdown appears with checkboxes organized by section
    And the sections include Standard, Evaluations, and Events

  Scenario: Toggling a column on adds it to the table
    Given the Columns dropdown is open
    And the "Service" column is hidden
    When the user checks the "Service" checkbox
    Then the "Service" column appears in the trace table
    And it is added at the end of the column order before any right-pinned column

  Scenario: Toggling a column off removes it from the table
    Given the Columns dropdown is open
    And the "Cost" column is visible
    When the user unchecks the "Cost" checkbox
    Then the "Cost" column is removed from the trace table

  Scenario: Toggling a column puts the lens into draft state
    Given the Columns dropdown is open
    When the user toggles any column checkbox
    Then the active lens enters draft state with a dot indicator on its tab


# ─────────────────────────────────────────────────────────────────────────────
# COLUMN DRAG-TO-REORDER
# ─────────────────────────────────────────────────────────────────────────────

Feature: Column drag-to-reorder
  Users drag column headers to rearrange the display order of columns.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a lens is active with columns Time, Trace, Duration, Cost, Tokens, and Model visible

  Scenario: Column header shows grab cursor on hover
    When the user hovers over a non-pinned column header
    Then the cursor changes to grab

  Scenario: Dragging a column shows visual feedback
    When the user drags the "Cost" column header
    Then a semi-transparent ghost of the column header follows the cursor
    And the cursor changes to grabbing

  Scenario: Drop target shows a blue insertion line
    When the user drags "Cost" between "Trace" and "Duration"
    Then a blue vertical insertion line appears between "Trace" and "Duration"

  Scenario: Dropping a column reorders the table
    When the user drags "Cost" and drops it before "Duration"
    Then the column order becomes Time, Trace, Cost, Duration, Tokens, Model

  Scenario: Reordering puts the lens into draft state
    When the user drags and drops a column to a new position
    Then the active lens enters draft state with a dot indicator on its tab

  Scenario: Pinned column cannot be dragged
    When the user hovers over the Time column header
    Then the cursor does not change to grab
    And dragging the Time column has no effect

  Scenario: Column cannot be dragged before a left-pinned column
    When the user drags "Cost" to the left of the Time column
    Then the column snaps to the nearest valid position after Time

  Scenario: Column order persists in the LensConfig columns array
    When the user reorders columns
    Then the columns array order in the LensConfig matches the new display order


# ─────────────────────────────────────────────────────────────────────────────
# COLUMN DRAG-TO-REORDER ACCESSIBILITY
# ─────────────────────────────────────────────────────────────────────────────

Feature: Column reorder keyboard and screen reader support
  Users can reorder columns via keyboard and receive screen reader announcements.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a lens is active with multiple columns visible

  Scenario: Keyboard reorder via arrow keys
    When the user focuses a column header and presses Enter
    And presses the Right arrow key
    Then the column moves one position to the right
    And pressing Enter confirms the new position

  Scenario: Cancelling keyboard reorder with Escape
    When the user focuses a column header and presses Enter
    And presses the Right arrow key
    And presses Escape
    Then the column returns to its original position

  Scenario: Screen reader announces reorder mode
    When the user activates reorder mode on a column header
    Then the screen reader announces "Move [column name] column. Use left and right arrows to reposition."


# ─────────────────────────────────────────────────────────────────────────────
# COLUMN RESIZE
# ─────────────────────────────────────────────────────────────────────────────

Feature: Column resize
  Users drag column borders to adjust column widths.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a lens is active with default columns visible

  Scenario: Resize handle appears on column border hover
    When the user hovers over the right border of a column header
    Then a 4px invisible hit area is active
    And the cursor changes to col-resize

  Scenario: Dragging the border resizes the column
    When the user drags the right border of the "Duration" column to the right
    Then the "Duration" column becomes wider
    And adjacent columns are not resized

  Scenario: Table scrolls horizontally when columns exceed container
    When the user widens columns so the total width exceeds the container
    Then a horizontal scrollbar appears on the table

  Scenario: Column cannot be resized below its minimum width
    When the user drags the right border of a column to shrink it
    Then the column width stops at its defined minimum width

  Scenario: Column has no maximum width
    When the user drags the right border of a column far to the right
    Then the column continues to widen without limit

  Scenario: Double-clicking the border auto-fits column width
    When the user double-clicks the right border of a column header
    Then the column width adjusts to fit the widest content in visible rows plus 16px padding

  Scenario: Resizing puts the lens into draft state
    When the user resizes any column
    Then the active lens enters draft state with a dot indicator on its tab

  Scenario: Column width persists in the LensConfig
    When the user resizes the "Trace" column to 350px
    Then the width field for "Trace" in the LensConfig columns array reads 350


# ─────────────────────────────────────────────────────────────────────────────
# PINNED COLUMN RESIZE
# ─────────────────────────────────────────────────────────────────────────────

Feature: Pinned column resize
  Pinned columns can be resized even though they cannot be reordered.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a lens is active with the Time column pinned to the left

  Scenario: Pinned column can be resized
    When the user drags the right border of the Time column
    Then the Time column width changes

  Scenario: Resizing a pinned column adjusts the sticky offset
    When the user widens the Time column
    Then the sticky offset for adjacent columns adjusts accordingly


# ─────────────────────────────────────────────────────────────────────────────
# COLUMN STATE IN LENSCONFIG
# ─────────────────────────────────────────────────────────────────────────────

Feature: Column state in LensConfig
  The columns array in LensConfig defines the complete column layout including order, width, and pinning.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a lens is active

  Scenario: Array order determines display order
    Given the LensConfig columns array lists Trace before Duration
    When the trace table renders
    Then the Trace column appears to the left of the Duration column

  Scenario: Columns not in the array are hidden
    Given the LensConfig columns array does not include "Service"
    When the trace table renders
    Then the "Service" column is not visible in the table

  Scenario: Toggling a column on adds it before the last pinned-right column
    Given the LensConfig columns array ends with a right-pinned column
    When the user toggles a hidden column on
    Then the new column is inserted before the right-pinned column

  Scenario: Toggling a column off removes it from the array
    When the user hides the "Cost" column
    Then "Cost" is removed from the LensConfig columns array


# ─────────────────────────────────────────────────────────────────────────────
# DEFAULT COLUMN SET
# ─────────────────────────────────────────────────────────────────────────────

Feature: Default column set
  New lenses and reset-to-defaults use a standard set of columns and widths.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: New lens has default columns visible
    When the user creates a new lens
    Then the visible columns are Time, Trace, Duration, Cost, Tokens, and Model
    And the Service column is hidden by default

  Scenario: New lens has default column widths
    When the user creates a new lens
    Then Time has a width of 80px
    And Trace has a width of 300px
    And Duration has a width of 80px
    And Cost has a width of 80px
    And Tokens has a width of 80px
    And Model has a width of 100px

  Scenario: Time column is pinned left by default
    When the user creates a new lens
    Then the Time column is pinned to the left

  Scenario: Additional columns are available but hidden
    When the user opens the Columns dropdown on a new lens
    Then columns like TTFT, User ID, Conversation ID, Origin, and Environment are listed
    And they are unchecked by default

  Scenario: Resetting a lens restores default columns
    Given the user has customized columns on a lens
    When the user resets the lens to defaults
    Then the column set returns to the default visibility, order, and widths


# ─────────────────────────────────────────────────────────────────────────────
# INTERACTION WITH LENSES
# ─────────────────────────────────────────────────────────────────────────────

Feature: Column changes interact with lenses
  Column modifications put lenses into draft state with save and revert options.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Column change on a built-in lens enters draft state
    Given a built-in lens is active
    When the user changes column visibility, order, or width
    Then the lens enters draft state
    And the user can "Save as new lens" or "Revert"

  Scenario: Reverting a built-in lens restores original columns
    Given a built-in lens is in draft state due to column changes
    When the user clicks Revert
    Then the columns return to the built-in lens defaults

  Scenario: Column change on a custom lens enters draft state
    Given a custom lens is active
    When the user changes column visibility, order, or width
    Then the lens enters draft state
    And the user can "Save", "Save as new", or "Revert"

  Scenario: Saving a custom lens persists column changes
    Given a custom lens is in draft state due to column changes
    When the user clicks Save
    Then the column configuration is saved to the lens

  Scenario: New lens creation captures current column state
    Given the user has customized columns on the active lens
    When the user creates a new lens via the add button
    Then the new lens captures the current column visibility, order, and widths


# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Feature: Data gating for columns with missing data
  Columns with no data render gracefully without being hidden automatically.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a lens is active

  Scenario: Column with no data shows dash in every row
    Given the user has enabled a column that references a field with no data
    When the trace table renders
    Then every row in that column shows "—"
    And the column is not hidden automatically

  Scenario: Eval column for a nonexistent eval type shows dash
    Given the user has enabled an evaluation column for an eval type not in the project
    When the trace table renders
    Then the column header renders normally
    And every row shows "—"

  Scenario: Column width below minimum after restore is clamped
    Given a saved LensConfig has a column width below the defined minimum
    When the lens is loaded
    Then the column width is clamped to the minimum width
    And no error is raised


# ─────────────────────────────────────────────────────────────────────────────
# PERFORMANCE
# ─────────────────────────────────────────────────────────────────────────────

Feature: Column configuration performance
  Drag-to-reorder and resize interactions remain smooth without full table re-renders.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a lens is active with columns visible

  Scenario: Drag-to-reorder does not recalculate layout during drag
    When the user drags a column header
    Then only the ghost element moves during the drag
    And column positions update only on drop

  Scenario: Column resize does not trigger full table re-render
    When the user drags a column border to resize
    Then only the resizing column width updates during the drag
    And the full table does not re-render until the drag ends
