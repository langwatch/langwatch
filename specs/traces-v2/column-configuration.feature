# Column Configuration — Gherkin Spec
# Covers: column visibility, drag-to-reorder, column resize, lens state persistence, defaults, data gating

# ─────────────────────────────────────────────────────────────────────────────
# COLUMN VISIBILITY
# ─────────────────────────────────────────────────────────────────────────────

Feature: Column configuration

Rule: Column visibility toggle
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
    Then `viewStore.toggleColumn("service")` runs
    And `columnOrder` gains "service" appended at the end
    And the trace table renders the Service column

  Scenario: Toggling a column off removes it from the table
    Given the Columns dropdown is open
    And the "Cost" column is visible
    When the user unchecks the "Cost" checkbox
    Then "cost" is removed from `columnOrder`
    And the column disappears from the table

  Scenario: Pinned columns cannot be toggled off
    Given a column has `pinned="left"` (e.g. Time)
    Then its checkbox is disabled in the dropdown

  Scenario: Toggling a column puts the lens into draft state
    Given the Columns dropdown is open
    When the user toggles any column checkbox
    Then `viewStore.draftState` gains an entry for the active lens (`isDraft(lensId)` returns true)
    And the lens tab shows the draft indicator


# ─────────────────────────────────────────────────────────────────────────────
# COLUMN DRAG-TO-REORDER
# ─────────────────────────────────────────────────────────────────────────────
# Not yet implemented as of 2026-05-01 — `viewStore.reorderColumns` exists but
# no column-header DnD handler is wired up in `TraceTableShell`. The order
# only changes today via toggling columns on/off.

@planned
Rule: Column drag-to-reorder
  Users drag column headers to rearrange the display order of columns.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a lens is active with columns Time, Trace, Duration, Cost, Tokens, and Model visible

  Scenario: Dropping a column reorders the table
    When the user drags "Cost" and drops it before "Duration"
    Then the column order becomes Time, Trace, Cost, Duration, Tokens, Model

  Scenario: Reordering puts the lens into draft state
    When the user drags and drops a column to a new position
    Then the active lens enters draft state with a dot indicator on its tab

  Scenario: Pinned column cannot be dragged
    When the user attempts to drag the Time (left-pinned) column
    Then the column does not move

  Scenario: Column order persists in the LensConfig columns array
    When the user reorders columns
    Then the columns array order in the LensConfig matches the new display order


# ─────────────────────────────────────────────────────────────────────────────
# COLUMN RESIZE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Column resize
  Users drag column borders to adjust column widths.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a lens is active with default columns visible

  Scenario: Resize handle appears on column border hover
    When the user hovers over the right border of a column header
    Then a 6px hit area is active
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
    Then the column width stops at its defined minimum width (TanStack `enableColumnResizing` clamps via `minSize`)

  Scenario: Double-clicking the resize grip resets the column to its default width
    When the user double-clicks the right-edge resize grip on a column header
    Then `header.column.resetSize()` runs and the column returns to its default width
    # NOTE: this is "reset to default", not "auto-fit content"

  Scenario: Column width persists per (lens × rowKind) in localStorage
    When the user resizes the "Trace" column
    Then `columnSizingStore.setSizing(getColumnSizingKey(lensId, rowKind), …)` is called
    And the new width is persisted under `langwatch:traces-v2:column-sizing:v1`


# ─────────────────────────────────────────────────────────────────────────────
# PINNED COLUMN RESIZE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Pinned column resize
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

Rule: Column state split between LensConfig and columnSizingStore
  `LensConfig.columns: string[]` defines visible column ids (and their order).
  Per-column widths live in `columnSizingStore`, keyed by (lensId, rowKind).
  Pinning is intrinsic to the column definition (via `pinned: "left"` on
  `STANDARD_COLUMNS`), not stored per-lens.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a lens is active

  Scenario: Array order determines display order
    Given `LensConfig.columns` lists "trace" before "duration"
    When the trace table renders
    Then the Trace column appears to the left of the Duration column

  Scenario: Columns not in the array are hidden
    Given `LensConfig.columns` does not include "service"
    When the trace table renders
    Then the Service column is not visible

  Scenario: Toggling a column off removes it from the array
    When the user hides the "Cost" column
    Then "cost" is removed from `viewStore.columnOrder` (and from the saved LensConfig on save)


# ─────────────────────────────────────────────────────────────────────────────
# DEFAULT COLUMN SET
# ─────────────────────────────────────────────────────────────────────────────

Rule: Default column set
  New lenses and reset-to-defaults use a standard set of columns and widths.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: New lens has default columns visible
    When the user creates a new lens with grouping="flat" (the trace capability)
    Then `defaultColumns` are: time, trace, service, duration, cost, tokens, model
    # See LENS_CAPABILITIES.flat in `lens/capabilities.ts`

  Scenario: New lens has default minimum column widths
    When the user creates a new lens
    Then `STANDARD_COLUMNS` minWidths are: time 80, trace 300, service 120, duration 80, cost 80, tokens 80, model 100
    # Note: these are minimums (TanStack `minSize`), not fixed widths. Actual rendered widths come from columnSizingStore overrides on top of TanStack defaults.

  Scenario: Time column is pinned left by default
    When the user creates a new lens
    Then the Time column entry has `pinned: "left"` in `STANDARD_COLUMNS`

  Scenario: Additional columns are available but hidden by default
    When the user opens the Columns dropdown
    Then optional columns are listed: TTFT, User ID, Conversation ID, Origin, Tokens In, Tokens Out, Spans, Status
    And they are unchecked by default (each entry's `visible: false`)

  Scenario: Reverting a lens restores its committed configuration
    Given the user has customized columns on a built-in lens
    When the user clicks Revert
    Then `viewStore.revertLens(activeLensId)` clears the draftState entry
    And `columnOrder` resets back to the lens's saved `columns` array


# ─────────────────────────────────────────────────────────────────────────────
# INTERACTION WITH LENSES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Column changes interact with lenses
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

Rule: Data gating for columns with missing data
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

  Scenario: Persisted column widths survive reload
    Given the user resized columns on a previous session
    When the page reloads
    Then `columnSizingStore` reads `langwatch:traces-v2:column-sizing:v1` from localStorage
    And applies sizes for the active (lensId, rowKind) key
    And invalid/non-positive entries are dropped silently


# ─────────────────────────────────────────────────────────────────────────────
# PERFORMANCE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Column configuration performance
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
