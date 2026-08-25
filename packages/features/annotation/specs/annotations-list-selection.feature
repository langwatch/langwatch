Feature: Annotations list
  Inbox, my queue, a named queue, and all annotations share one review table.
  Reviewers select queue items, act on the selected traces, and export the
  rows currently in scope.

  Background:
    Given the user is authenticated with annotation view permission
    And the annotations list has rows

  Rule: Selection represents queue items and clears when its page changes

    @integration
    Scenario: Rows are selected independently
      When the user selects a row or the page header checkbox
      Then selection uses leading checkboxes without opening the row
      And two queue items for one trace count as two selected rows

    @integration
    Scenario: A changed result set clears selection
      Given rows are selected
      When the user changes the status filter or page
      Then no row remains selected and the selection bar is hidden

  Rule: Selected traces can be handed to a dataset or queues

    @integration
    Scenario: Dataset hand-off deduplicates selected traces
      Given selected rows include two queue items for one trace
      When the user chooses "Add to dataset"
      Then the dataset drawer receives that trace once
      And it does not open when a personal workspace declines datasets

    @integration
    Scenario: Queue actions respect the page's queue context
      Given selected rows are on the all-annotations page
      Then the bar offers "Add to queue"
      And a queue page offers "Move to queue" instead
      And keeping the current queue retains its items while deselecting it removes them

    @integration
    Scenario: Queue removal is available only for queue items
      Given selected rows are in a named queue
      When the user removes them
      Then exactly those queue items are removed and selection clears
      And all-annotations rows have no remove-from-queue action

  Rule: A row has focused actions and opens the next useful surface

    @integration
    Scenario: Row actions use an overflow menu
      When the user opens a row's actions menu
      Then it can view the trace or add that trace to a dataset
      And it can remove only a row that represents a queue item

    @integration
    Scenario: Row navigation follows review state
      When the user opens a pending queue item
      Then the annotation flow opens at that item
      But completed queue rows and all-annotation rows open the trace drawer

  Rule: Columns present review data without bypassing safeguards

    @integration
    Scenario: Dates and compact annotation summaries match the page
      Then queue rows use "Date queued" and all-annotation rows use "Date annotated"
      And suggestion and comment counts reveal their authored values on hover
      And comments name their anchored part of the trace

    @integration
    Scenario: Score and content columns follow project and privacy state
      Given the project has active and inactive score types
      Then there is one column per active score type and none for inactive-only types
      And input and output remain behind the redaction marker

  Rule: Page controls preserve each list's scope

    @integration
    Scenario: Queue pages filter and date their queue items
      Then they offer Pending, Completed, and All status filters
      And they include all pending items until a queued-at date range is chosen
      And "All time" removes that range

    @integration
    Scenario: All annotations keeps its independent date range and pages grouped rows
      Then it has no status or "All time" choice
      And it shows one page of grouped annotations at a time

    @integration
    Scenario: Export describes the visible list
      When the user exports a queue page
      Then the CSV has one line per row on screen and the shown columns
      But all annotations exports every annotation it loaded

  Rule: The sidebar identifies and administers the current list

    @integration
    Scenario: Exactly one list entry is active
      When a queue or top-level list is open
      Then only its matching sidebar entry is highlighted

    @integration
    Scenario: Queue edits begin at the queue entry
      Given the user may change resources
      When the sidebar lists a queue
      Then its own actions menu can open that queue's edit drawer
      But the queue page header has no duplicate queue menu
