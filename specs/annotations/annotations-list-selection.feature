# Implementation:
#   platform/app/src/components/annotations/AnnotationsTable.tsx  (checkbox column + selection bar)
#   platform/app/src/components/ui/SelectionActionBar.tsx         (shared floating bar)
#   platform/app/src/components/AddDatasetRecordDrawer.tsx        (the drawer the action opens)
#
# Motivation: reviewers curate in the annotations list and then want the rows
# they just judged in a dataset. Without selection the only way out of the list
# was a CSV export of everything, which then had to be re-imported by hand.

Feature: Annotations list selection

  The annotations list (all annotations, my annotations, and a single queue)
  lets the reviewer tick rows and act on the selection, the same way the trace
  table does: a leading checkbox column, and one floating bar at the bottom of
  the viewport carrying the count and the actions.

Rule: Rows are selected with a leading checkbox column

  The checkbox is a separate hit target from the row itself, because the row
  already navigates to the queue item or opens the trace.

  Background:
    Given the user is authenticated with "annotations:view" permission
    And the annotations list shows rows

  @integration
  Scenario: Every row carries a checkbox in a leading column
    When the annotations list renders
    Then each row has a checkbox before all other columns
    And the header carries a select-all checkbox for the page

  @integration
  Scenario: Ticking a row checkbox does not open the row
    When the user ticks a row's checkbox
    Then the row becomes selected
    And the row does not navigate to the queue item or the trace

  @integration
  Scenario: The header checkbox selects every row on the page
    Given no rows are selected
    When the user ticks the header checkbox
    Then every row on the page is selected

  @integration
  Scenario: The header checkbox clears a fully selected page
    Given every row on the page is selected
    When the user ticks the header checkbox
    Then no rows are selected

  @integration
  Scenario: Rows that share a trace count once
    Given two rows on the page were queued for the same trace
    When the user selects both rows
    Then the selection counts that trace once

  @integration
  Scenario: Changing the status filter clears the selection
    Given rows are selected
    When the user switches the status filter
    Then no rows are selected
    And the selection bar disappears

  @integration
  Scenario: Moving to another page clears the selection
    Given rows are selected
    When the user moves to the next page
    Then no rows are selected

Rule: Selected annotations can be added to a dataset

  The selection bar is the shared floating bar, so the annotations list, the
  trace table, and the dataset editor all read the same.

  Background:
    Given the user is authenticated with "annotations:view" permission
    And the annotations list shows rows

  @integration
  Scenario: The selection bar appears with the count and the action
    Given no rows are selected
    When the user selects 2 rows
    Then a floating bar shows "2 selected"
    And it offers "Add to dataset"

  @integration
  Scenario: The selection bar is hidden while nothing is selected
    When zero rows are selected
    Then no selection bar is shown

  @integration
  Scenario: Add to dataset opens the dataset drawer with the selected traces
    Given 2 rows for different traces are selected
    When the user clicks "Add to dataset"
    Then the add-to-dataset drawer opens with those 2 trace ids

  @integration
  Scenario: Add to dataset waits for the personal workspace to allow datasets
    Given the user is on their own personal project with datasets turned off
    And rows are selected
    When the user clicks "Add to dataset" and declines to turn datasets on
    Then the add-to-dataset drawer does not open
