# Bulk Actions — Gherkin Spec
# Multi-select traces in the table, then export or add to dataset.
# Reuses existing useExportTraces hook, ExportConfigDialog, and
# AddDatasetRecordDrawerV2 — all already wired into the OLD MessagesTable.

# ─────────────────────────────────────────────────────────────────────────────
# CHECKBOX COLUMN
# ─────────────────────────────────────────────────────────────────────────────

Feature: Bulk actions

Rule: Selection checkbox column
  A leading checkbox column lets the user pick rows for bulk actions.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Checkbox column is the first column in every lens
    When the trace table renders
    Then a checkbox column appears before all other columns
    And it is fixed and not draggable
    And it is not listed in the columns dropdown

  Scenario: Header checkbox reflects page selection state
    Given the current page has 50 trace rows
    Then the header checkbox is unchecked when no rows are selected
    And the header checkbox is in a partial (indeterminate) state when 1–49 rows are selected
    And the header checkbox is fully checked when all 50 rows are selected

  Scenario: Toggling a row checkbox does not open the drawer
    When the user clicks a row's checkbox
    Then the row's selection toggles
    And the trace drawer does not open
    And no row navigation occurs

  Scenario: Toggling the header checkbox selects every row on the page
    Given no rows are selected
    When the user clicks the header checkbox
    Then every row on the current page becomes selected
    And rows on other pages are not affected

  Scenario: Toggling a fully-checked header clears the page selection
    Given every row on the current page is selected
    When the user clicks the header checkbox
    Then every row on the current page becomes unselected

  Scenario: Toggling an indeterminate header selects every row on the page
    Given some but not all rows on the page are selected
    When the user clicks the header checkbox
    Then every row on the current page becomes selected

  Scenario: Conversation lens parent toggle cascades to children
    Given the Conversation lens is active
    When the user toggles a conversation row's checkbox
    Then every trace in that conversation toggles to the same state
    And the conversation row reflects partial state when only some children are selected

  Scenario: Group lens parent toggle cascades to grouped traces
    Given a grouping is active
    When the user toggles a group row's checkbox
    Then every trace within the group toggles to the same state

  Scenario: Onboarding empty state hides the checkbox column
    Given the project has zero traces
    Then the checkbox column is not rendered

  Scenario: Empty filter state hides the checkbox column header
    Given filters are active
    And no traces match the current filters
    Then the header checkbox is not rendered


# ─────────────────────────────────────────────────────────────────────────────
# SELECTION STATE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Selection persistence and lifecycle
  Selection state survives scrolling and pagination but resets when filters change.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Selection persists when scrolling within the same page
    Given 10 rows are selected
    When the user scrolls the table
    Then the same 10 rows remain selected

  Scenario: Selection persists across pagination
    Given 10 rows on page 1 are selected
    When the user navigates to page 2
    And the user navigates back to page 1
    Then the same 10 rows are still selected

  Scenario: Selection clears when filters change
    Given 10 rows are selected
    When the user adds a filter
    Then the selection is cleared
    And the bulk action bar disappears

  Scenario: Selection clears when the time range changes
    Given 10 rows are selected
    When the user changes the time range
    Then the selection is cleared

  Scenario: Selection clears when the lens changes
    Given 10 rows are selected
    When the user switches lens
    Then the selection is cleared

  Scenario: Selection survives column visibility toggles
    Given 10 rows are selected
    When the user toggles a column's visibility
    Then the selection is unchanged


# ─────────────────────────────────────────────────────────────────────────────
# BULK ACTION BAR
# ─────────────────────────────────────────────────────────────────────────────

Rule: Bulk action bar
  A contextual action bar appears above the table whenever rows are selected.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Bulk action bar is hidden when no rows are selected
    When zero rows are selected
    Then the bulk action bar is not visible

  Scenario: Bulk action bar appears when at least one row is selected
    When the user selects a row
    Then the bulk action bar appears between the toolbar and the table
    And it shows "1 selected"
    And it offers "Export selected", "Add to dataset", and "Clear" actions

  Scenario: Bulk action bar count updates as selection changes
    Given 1 row is selected
    When the user selects 4 more rows
    Then the bulk action bar shows "5 selected"

  Scenario: Clear button empties the selection
    Given 5 rows are selected
    When the user clicks "Clear"
    Then no rows are selected
    And the bulk action bar disappears

  Scenario: Select-all-matching affordance appears when all visible rows are selected
    Given the page shows 50 rows
    And the filtered query has 1,234 matching traces
    And the user has selected every row on the current page
    Then the bulk action bar shows "All 50 on this page selected. Select all 1,234 matching"

  Scenario: Activating select-all-matching switches to filter-based selection
    Given the bulk action bar shows the "Select all 1,234 matching" affordance
    When the user clicks "Select all 1,234 matching"
    Then the bulk action bar shows "1,234 selected"
    And subsequent bulk actions operate on every matching trace, not on a fixed ID list

  Scenario: Select-all-matching clears when the user toggles a row
    Given select-all-matching is active for 1,234 traces
    When the user unchecks a single row
    Then the selection switches to explicit IDs (1,233 selected)
    And the select-all-matching mode is cancelled

  Scenario: Select-all-matching cap matches export cap
    Given the filtered query has 25,000 matching traces
    When the user activates select-all-matching
    Then the bulk action bar shows "10,000 selected (max)"
    And a tooltip explains the 10,000-trace cap


# ─────────────────────────────────────────────────────────────────────────────
# EXPORT
# ─────────────────────────────────────────────────────────────────────────────

Rule: Export traces
  Export is available for all matching traces or for a specific selection.
  Reuses the existing /api/export/traces/download endpoint.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Export-all button is always visible in the toolbar
    When the trace table renders
    Then an "Export" button is visible in the toolbar
    And it is enabled regardless of selection state

  Scenario: Export-all uses current filters
    When the user clicks the toolbar "Export" button
    Then the export config dialog opens
    And the dialog shows the total matching trace count (capped at 10,000)
    And the dialog does not say "selected"

  Scenario: Export selected uses the chosen trace IDs
    Given 7 rows are selected
    When the user clicks "Export selected" in the bulk action bar
    Then the export config dialog opens
    And the dialog header indicates 7 selected traces will be exported

  Scenario: Export selected with select-all-matching uses filters not IDs
    Given select-all-matching is active for 1,234 traces
    When the user clicks "Export selected"
    Then the export request uses the current filters and time range
    And no per-trace ID list is sent to the backend

  Scenario: Export config dialog offers mode and format
    When the export config dialog is open
    Then the user can choose mode: summary or full
    And the user can choose format: CSV or JSONL

  Scenario: Export progress indicator shows during streaming
    When an export is in progress
    Then a progress indicator shows "Exported N of M traces"
    And a Cancel button is available
    And cancelling stops the stream and dismisses the indicator

  Scenario: Successful export triggers file download
    When an export completes
    Then the browser downloads the resulting file
    And the progress indicator dismisses

  Scenario: Export fails gracefully
    When an export errors mid-stream
    Then an error toast is shown
    And the progress indicator dismisses
    And no partial file is downloaded


# ─────────────────────────────────────────────────────────────────────────────
# ADD TO DATASET
# ─────────────────────────────────────────────────────────────────────────────

Rule: Add selected traces to a dataset
  Reuses the existing AddDatasetRecordDrawerV2 with selectedTraceIds.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces
    And at least one dataset exists

  Scenario: Add-to-dataset is only available when rows are selected
    When zero rows are selected
    Then no "Add to dataset" action is visible in the toolbar

  Scenario: Add selected traces opens the dataset drawer
    Given 3 rows are selected
    When the user clicks "Add to dataset" in the bulk action bar
    Then the AddDatasetRecord drawer opens
    And the drawer is preloaded with the 3 selected trace IDs

  Scenario: Drawer maps selected traces to the chosen dataset columns
    Given the AddDatasetRecord drawer is open with 3 selected traces
    When the user picks a dataset
    Then the drawer shows column mappings for the 3 traces
    And the user can confirm to insert the records

  Scenario: Successful insert clears the selection and closes the drawer
    Given the user has selected 3 traces and opened the dataset drawer
    When the insert succeeds
    Then the drawer closes
    And the selection is cleared
    And a success toast confirms the insert

  Scenario: Add-to-dataset with select-all-matching is not supported
    Given select-all-matching is active for 1,234 traces
    Then the "Add to dataset" action is disabled
    And a tooltip explains that explicit selection is required


# ─────────────────────────────────────────────────────────────────────────────
# KEYBOARD AND ACCESSIBILITY
# ─────────────────────────────────────────────────────────────────────────────

Rule: Keyboard support for selection
  Selection works via keyboard for accessibility and power-user flows.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Space toggles selection on the focused row
    Given a row is keyboard-focused
    When the user presses Space
    Then that row's selection toggles
    And the drawer does not open

  Scenario: Shift-click selects a contiguous range
    Given the user has clicked a row's checkbox
    When the user shift-clicks another row's checkbox
    Then every row between the two (inclusive) becomes selected

  Scenario: Escape clears the selection when the bulk action bar is focused
    Given 5 rows are selected
    When the user focuses the bulk action bar
    And presses Escape
    Then the selection is cleared

  Scenario: Checkboxes have accessible labels
    Then each row checkbox has an aria-label identifying the trace
    And the header checkbox has an aria-label "Select all on this page"
