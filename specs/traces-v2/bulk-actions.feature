# Bulk Actions — Gherkin Spec
# Multi-select traces in the table, then export, add to dataset, or send to an
# annotation queue.
# Reuses existing useExportTraces hook, ExportConfigDialog,
# AddDatasetRecordDrawerV2, and the AddParticipants queue picker.

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
    # SelectHeaderCheckbox derives state from `traceIdSet` plus `mode` —
    # in `all-matching` mode the header always reads as fully checked.

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

  @planned
  Scenario: Onboarding empty state hides the checkbox column
    # Not yet implemented as of 2026-05-01 — the onboarding/empty path renders
    # `EmptyFilterState` instead of the table, so the checkbox column is
    # naturally absent. There is no explicit gate on the column itself.
    Given the project has zero traces
    Then the checkbox column is not rendered

  Scenario: Header checkbox is hidden when no rows are visible
    Given filters are active
    And no traces match the current filters
    Then `SelectHeaderCheckbox` short-circuits to null when `traceIds` is empty


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

  Scenario: Selection clears when the filter query text changes
    Given 10 rows are selected
    When the user changes the debounced query text
    Then `useResetSelectionOnViewChange` clears the selection
    And the bulk action bar disappears

  Scenario: Selection clears when the time range changes
    Given 10 rows are selected
    When the user changes the time range (label or absolute from/to)
    Then the selection is cleared
    # While a relative-time label is active, the rolling from/to ticking is
    # collapsed onto the label so selection is not cleared every minute.

  Scenario: Selection clears when the active lens changes
    Given 10 rows are selected
    When the user switches the active lens
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
    Then the bulk action bar appears as a fixed-position floating bar at the bottom-centre of the viewport
    And it shows "1 selected"
    And it offers "Export selected", "Add to dataset", and an X icon to clear

  Scenario: Bulk action bar count updates as selection changes
    Given 1 row is selected
    When the user selects 4 more rows
    Then the bulk action bar shows "5 selected"

  Scenario: X button clears the selection
    Given 5 rows are selected
    When the user clicks the X "Clear selection" button
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
    # `SELECT_ALL_MATCHING_CAP = 10_000` matches the export endpoint cap.
    # No tooltip is currently rendered to explain the cap.


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

  Scenario: Add-to-dataset only appears in the floating bulk action bar
    When zero rows are selected
    Then the bulk action bar (and its "Add to dataset" button) is not rendered
    # There is no toolbar-level "Add to dataset" entry — the action lives
    # exclusively on `BulkActionBar`.

  Scenario: Add selected traces opens the dataset drawer
    Given 3 rows are selected
    When the user clicks "Add to dataset" in the bulk action bar
    Then `openDrawer("addDatasetRecord", { selectedTraceIds: [...] })` is called with the 3 selected ids

  Scenario: Add-to-dataset with select-all-matching is disabled
    Given select-all-matching is active for 1,234 traces
    Then the "Add to dataset" button has `disabled` set
    And a tooltip reads "Disabled — add to dataset requires explicit row selection."

  @planned
  Scenario: Drawer maps selected traces to the chosen dataset columns
    # Behaviour lives inside `AddDatasetRecordDrawerV2`; not gated by traces-v2.
    Given the AddDatasetRecord drawer is open with 3 selected traces
    When the user picks a dataset
    Then the drawer shows column mappings for the 3 traces
    And the user can confirm to insert the records

  @planned
  Scenario: Successful insert clears the selection and closes the drawer
    # `BulkActionBar` does not subscribe to a post-insert success event.
    # Explicit selection clearing on success is not yet wired.
    Given the user has selected 3 traces and opened the dataset drawer
    When the insert succeeds
    Then the drawer closes
    And the selection is cleared
    And a success toast confirms the insert


# ─────────────────────────────────────────────────────────────────────────────
# ADD TO ANNOTATION QUEUE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Send selected traces to an annotation queue
  Picking rows and handing them to a reviewer is a first-class bulk action,
  next to export and add-to-dataset. The dialog reuses the same participants
  picker (people and queues) the rest of the product uses.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the user is authenticated with "annotations:create" permission
    And the project has traces

  @integration
  Scenario: Add to annotation queue sits between Add to context and Add to dataset
    Given 3 rows are selected
    Then the bulk action bar offers "Add to annotation queue"
    And it reads after "Add to context" and before "Add to dataset"

  @integration
  Scenario: The action is hidden without permission to create annotations
    Given the user cannot create annotations
    When rows are selected
    Then the bulk action bar does not offer "Add to annotation queue"
    And the other bulk actions are unaffected

  @integration
  Scenario: Add to annotation queue is disabled in select-all-matching mode
    Given select-all-matching is active for 1,234 traces
    Then the "Add to annotation queue" button is disabled
    And a tooltip explains the action needs an explicit row selection

  @integration
  Scenario: Opening the dialog carries the selected trace ids
    Given 3 rows are selected
    When the user clicks "Add to annotation queue"
    Then the dialog opens for exactly those 3 traces

  @integration
  Scenario: The dialog says where the traces are going
    Given the dialog is open for 3 selected traces
    Then it is titled "Add to annotation queue"
    And it explains that the selected traces are sent to people or queues for annotation

  @integration
  Scenario: Sending queues every selected trace for the chosen participants
    Given the dialog is open for 3 selected traces
    And the user picked a person and a queue
    When the user sends
    Then the three traces are queued for both participants

  @integration
  Scenario: A successful send refreshes the annotation counts
    Given the dialog is open for 3 selected traces
    When the send succeeds
    Then the pending, assigned and per-queue counts are refreshed
    And the queue listing is refreshed
    And the dialog closes

  @integration
  Scenario: A successful send confirms and offers a way to open the queues
    Given the dialog is open for 3 selected traces
    When the send succeeds
    Then a confirmation reads "Added to annotation queue"
    And it says how many traces were sent for annotation
    And it offers "View queues", which opens the project's annotations page

  @integration
  Scenario: A queue can be created without leaving the dialog
    Given the dialog is open and none of the existing queues fit
    When the user chooses to add a new queue
    Then the new queue drawer opens over the dialog

  @integration
  Scenario: A failed send says the traces were not queued
    Given the dialog is open for 3 selected traces
    When the send fails
    Then the failure is reported as "Couldn't add to annotation queue"
    And the counts are not refreshed

  Scenario: The trace drawer offers the same action for a single trace
    # Same dialog, one trace: `TraceOverflowMenu` -> `DrawerHeader` owns the
    # open state, alongside the share dialog and behind the same read-only guard.
    Given a trace is open in the drawer
    When the user picks "Add to annotation queue" from the overflow menu
    Then the same dialog opens for that one trace

  Scenario: A shared trace never offers the action
    Given the trace drawer is rendered read-only on a share page
    Then no annotation queue action is offered


# ─────────────────────────────────────────────────────────────────────────────
# KEYBOARD AND ACCESSIBILITY
# ─────────────────────────────────────────────────────────────────────────────

Rule: Keyboard support for selection
  Selection works via keyboard for accessibility and power-user flows.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Header checkbox has an accessible label
    Then the header `SelectHeaderCheckbox` exposes `aria-label="Select all on this page"`
    And exposes `aria-checked` of "true" / "false" / "mixed" mapped from the selection state

  @planned
  Scenario: Space toggles selection on the focused row
    # Not yet implemented as of 2026-05-01 — there is no keyboard handler
    # that toggles the focused row's selection on Space.
    Given a row is keyboard-focused
    When the user presses Space
    Then that row's selection toggles
    And the drawer does not open

  @planned
  Scenario: Shift-click selects a contiguous range
    # Not yet implemented as of 2026-05-01 — `SelectHeaderCheckbox` /
    # row checkboxes don't track an anchor for shift-click range selection.
    Given the user has clicked a row's checkbox
    When the user shift-clicks another row's checkbox
    Then every row between the two (inclusive) becomes selected

  @planned
  Scenario: Escape clears the selection when the bulk action bar is focused
    # Not yet implemented as of 2026-05-01 — `BulkActionBar` has no Escape
    # listener; clearing happens via the X icon button or upstream state.
    Given 5 rows are selected
    When the user focuses the bulk action bar
    And presses Escape
    Then the selection is cleared

  @planned
  Scenario: Per-row checkbox aria labels
    # Not yet implemented as of 2026-05-01 — row cells render the Checkbox
    # primitive without a per-trace aria-label identifying the row.
    Then each row checkbox has an aria-label identifying the trace
