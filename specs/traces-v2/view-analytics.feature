# Lens Analytics — Gherkin Spec
# Covers: event firing, event schema, debounce rules, localStorage storage, FIFO cap, data gating, migration path, privacy
#
# STATUS as of 2026-05-01: Not yet implemented.
#   - No `trackLensEvent` function exists anywhere under `langwatch/src/features/traces-v2/`.
#   - No PostHog / analytics calls fire from the lens / column / grouping / formatting flows.
#   - No `langwatch:lensAnalytics:{projectId}` localStorage key is written.
#   - Conditional formatting itself (referenced in some scenarios) is also unimplemented,
#     so the formatting-event scenarios are doubly aspirational.
#
# Treat this entire feature file as the design intent for Phase 2/3A analytics; it
# describes target behavior, not current behavior.

# ─────────────────────────────────────────────────────────────────────────────
# LENS LIFECYCLE EVENTS
# ─────────────────────────────────────────────────────────────────────────────

@planned
Feature: Lens analytics

Rule: Lens lifecycle event tracking
  When a user creates, saves, deletes, renames, duplicates, or reverts a lens,
  the system silently logs a corresponding analytics event.

  Background:
    Given the user is authenticated
    And the user is viewing the Observe page for a project

  Scenario: Creating a new lens logs a lens_created event
    When the user clicks [+] and saves a new lens named "Debug View" with columns "cost" and "model" and grouping "model"
    Then a lens_created event is logged with the new lensId, name "Debug View", columns ["cost", "model"], and grouping "model"

  Scenario: Saving an existing lens logs a lens_saved event
    Given the user has modified columns and grouping on a lens
    When the user saves the lens
    Then a lens_saved event is logged with the lensId and a changes list describing what was modified

  Scenario: Deleting a custom lens logs a lens_deleted event
    When the user deletes a custom lens
    Then a lens_deleted event is logged with the lensId

  Scenario: Renaming a lens logs a lens_renamed event
    When the user renames a lens from "Old Name" to "New Name"
    Then a lens_renamed event is logged with the lensId, oldName "Old Name", and newName "New Name"

  Scenario: Duplicating a lens logs a lens_duplicated event
    When the user duplicates a lens
    Then a lens_duplicated event is logged with the sourceLensId and newLensId

  Scenario: Reverting changes on a lens logs a lens_reverted event
    When the user reverts changes on a lens
    Then a lens_reverted event is logged with the lensId


# ─────────────────────────────────────────────────────────────────────────────
# LENS SWITCHING EVENTS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Lens switching event tracking
  When a user switches between lens tabs, each switch is logged
  to track exploration patterns.

  Background:
    Given the user is authenticated
    And the user is viewing the Observe page with multiple lenses

  Scenario: Switching lenses logs a lens_switched event
    When the user clicks a different lens tab
    Then a lens_switched event is logged with fromLensId and toLensId

  Scenario: Rapid lens switching logs every switch individually
    When the user clicks three different lens tabs in quick succession
    Then three separate lens_switched events are logged with no debounce


# ─────────────────────────────────────────────────────────────────────────────
# COLUMN EVENTS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Column interaction event tracking
  When a user toggles, reorders, or resizes columns, the system
  logs per-column analytics events.

  Background:
    Given the user is authenticated
    And the user is viewing the Observe page with a lens active

  Scenario: Toggling a column logs a column_toggled event
    When the user toggles the visibility of a column
    Then a column_toggled event is logged with the lensId, columnId, and visible state

  Scenario: Rapid column toggling logs every toggle individually
    When the user toggles three columns in quick succession
    Then three separate column_toggled events are logged with no debounce

  Scenario: Reordering a column logs a column_reordered event on drop
    When the user drags a column to a new position and drops it
    Then a column_reordered event is logged with the lensId, columnId, fromIndex, and toIndex

  Scenario: Dragging a column without dropping does not log an event
    When the user begins dragging a column but has not dropped it yet
    Then no column_reordered event is logged

  Scenario: Resizing a column logs a column_resized event on mouseup
    When the user drags a column resize handle and releases the mouse
    Then a column_resized event is logged with the lensId, columnId, and final width

  Scenario: Dragging a column resize handle without releasing does not log intermediate events
    When the user drags a column resize handle through multiple positions
    Then no column_resized events are logged until the mouse is released


# ─────────────────────────────────────────────────────────────────────────────
# GROUPING EVENTS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Grouping change event tracking
  When a user changes the grouping dropdown, the system logs the transition.

  Background:
    Given the user is authenticated
    And the user is viewing the Observe page with a lens active

  Scenario: Changing the grouping dropdown logs a grouping_changed event
    When the user changes the grouping from "none" to "model"
    Then a grouping_changed event is logged with the lensId, from "none", and to "model"


# ─────────────────────────────────────────────────────────────────────────────
# CONDITIONAL FORMATTING EVENTS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Conditional formatting event tracking
  When a user adds or removes conditional formatting rules, the system logs
  the configuration details.

  Background:
    Given the user is authenticated
    And the user is viewing the Observe page with a lens active

  Scenario: Adding a conditional format rule logs a conditional_format_added event
    When the user adds a conditional formatting rule on a column with operator ">", value 100, and color "red"
    Then a conditional_format_added event is logged with the lensId, columnId, operator ">", value 100, and color "red"

  Scenario: Removing a conditional format rule logs a conditional_format_removed event
    When the user removes a conditional formatting rule from a column
    Then a conditional_format_removed event is logged with the lensId and columnId


# ─────────────────────────────────────────────────────────────────────────────
# DRAFT DISCARD EVENTS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Draft discard event tracking
  When a user navigates away from a modified lens without saving,
  the system silently tracks the discard.

  Background:
    Given the user is authenticated
    And the user has made unsaved changes to a lens

  Scenario: Navigating away from a modified lens logs a draft_discarded event
    When the user navigates away from the modified lens without saving
    Then a draft_discarded event is logged with the lensId


# ─────────────────────────────────────────────────────────────────────────────
# EVENT SCHEMA
# ─────────────────────────────────────────────────────────────────────────────

Rule: Analytics event schema
  Every analytics event includes automatic metadata fields
  and references the originating lens config.

  Scenario: Every event includes timestamp and projectId
    When any lens analytics event is logged
    Then the event includes a timestamp in ISO 8601 format
    And the event includes the current projectId

  Scenario: The lensId references the LensConfig identifier
    When a lens analytics event with a lensId is logged
    Then the lensId matches the LensConfig.id of the affected lens


# ─────────────────────────────────────────────────────────────────────────────
# LOCAL STORAGE
# ─────────────────────────────────────────────────────────────────────────────

Rule: localStorage event storage
  Phase 2 stores analytics events in localStorage as a JSON array,
  with no user-facing UI for viewing them.

  Background:
    Given the user is authenticated
    And the user is viewing the Observe page for a project

  Scenario: Events are stored under a project-scoped localStorage key
    When a lens analytics event is logged
    Then the event is appended to the localStorage key "langwatch:lensAnalytics:{projectId}"
    And the stored value is a JSON array of LensAnalyticsEvent objects

  Scenario: Events are invisible to the user
    When lens analytics events have been logged
    Then no UI element displays or references the stored events
    And the events are only visible via browser DevTools

  Scenario: Events never leave the browser
    When lens analytics events are logged in Phase 2
    Then no network requests are made to send the events to a server


# ─────────────────────────────────────────────────────────────────────────────
# FIFO CAP
# ─────────────────────────────────────────────────────────────────────────────

Rule: FIFO event cap
  The localStorage event buffer is capped at 1000 events.
  Oldest events are dropped when the cap is reached.

  Background:
    Given the user is authenticated
    And the user is viewing the Observe page for a project

  Scenario: Events accumulate up to 1000
    Given 999 events are stored in localStorage
    When one more event is logged
    Then the stored array contains exactly 1000 events

  Scenario: Oldest events are dropped when cap is exceeded
    Given 1000 events are stored in localStorage
    When one more event is logged
    Then the oldest event is dropped
    And the stored array contains exactly 1000 events
    And the newest event is the last element in the array


# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Analytics data gating
  Analytics is best-effort and never blocks the UI.
  Failures are handled silently.

  Scenario: localStorage unavailable causes silent failure
    Given localStorage is unavailable due to private browsing or quota limits
    When a lens analytics event fires
    Then no error is thrown
    And no retry is attempted
    And the UI continues to function normally

  Scenario: Storage quota exceeded triggers cleanup
    Given the localStorage quota is exceeded when writing an event
    Then the oldest 100 events are dropped to make room
    And the new event is written successfully

  Scenario: Corrupted stored data is silently reset
    Given the stored event array contains unparseable data
    When a lens analytics event fires
    Then the stored array is silently reset to empty
    And a console warning is logged
    And the new event is written to the reset array


# ─────────────────────────────────────────────────────────────────────────────
# MIGRATION PATH
# ─────────────────────────────────────────────────────────────────────────────

Rule: trackLensEvent migration interface
  The analytics module exposes a single function that components call.
  The implementation changes between phases but the interface stays the same.

  Scenario: trackLensEvent accepts an event without timestamp or projectId
    When a component calls trackLensEvent with only the event type and its payload
    Then timestamp and projectId are added automatically by the implementation

  Scenario: Phase 2 implementation writes to localStorage
    When trackLensEvent is called in Phase 2
    Then the event is appended to the localStorage array

  Scenario: Changing the backend does not require callers to change
    Given components call trackLensEvent the same way in Phase 2 and Phase 3A
    Then only the internal implementation of trackLensEvent changes between phases


# ─────────────────────────────────────────────────────────────────────────────
# PRIVACY
# ─────────────────────────────────────────────────────────────────────────────

Rule: Analytics privacy guarantees
  Events contain only structural metadata about lens configuration.
  No trace content, user data, or PII is included.

  Scenario: Events contain only lens and column identifiers
    When any lens analytics event is logged
    Then the event contains lens IDs, column IDs, and grouping values
    And the event does not contain trace content, user data, or PII

  Scenario: Events are project-scoped, not user-scoped
    When a lens analytics event is logged
    Then the event is tied to a projectId
    And the event does not contain a userId
