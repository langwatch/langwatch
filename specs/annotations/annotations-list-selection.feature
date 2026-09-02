# Implementation:
#   platform/app/src/components/annotations/AnnotationsTable.tsx      (the one table behind all four pages)
#   platform/app/src/components/annotations/annotationRow.ts          (the row every page adapts to)
#   platform/app/src/components/annotations/AnnotationCommentsChip.tsx (comments count + hover list)
#   platform/app/src/components/ui/SelectionActionBar.tsx             (shared floating bar)
#   platform/app/src/components/AddDatasetRecordDrawer.tsx            (the drawer the action opens)
#   platform/app/src/utils/downloadCsv.ts                             (the one CSV download)
#
# Motivation: reviewers curate in the annotations list and then want the rows
# they just judged in a dataset, or out of their queue. Without selection and
# row actions the only ways out of the list were a CSV export of everything and
# a queue item nobody could remove.

Feature: Annotations list

  Inbox, my queue, a single queue, and all annotations are one table. The
  reviewer picks rows, acts on the selection or on a single row, filters by
  status and date, and takes what is on screen to a CSV.

Rule: Rows are picked by queue item

  A trace can sit in several queues at once, so a row is a queue item, not a
  trace. What is handed to a dataset is deduplicated back to traces, because a
  dataset record is per trace.

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
  Scenario: Two rows queued for the same trace are picked separately
    Given two rows on the page were queued for the same trace in different queues
    When the user selects both rows
    Then the bar counts two selected rows

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

Rule: Selected rows can be added to a dataset

  The selection bar is the shared floating bar, so the annotations list, the
  trace table, and the dataset editor all read the same.

  Background:
    Given the user is authenticated with "annotations:view" permission
    And the annotations list shows rows

  @integration
  Scenario: The selection bar appears with the count and the actions
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
  Scenario: Add to dataset counts a trace shared by two rows once
    Given two selected rows were queued for the same trace
    When the user clicks "Add to dataset"
    Then the drawer opens with that trace id once

  @integration
  Scenario: Add to dataset waits for the personal workspace to allow datasets
    Given the user is on their own personal project with datasets turned off
    And rows are selected
    When the user clicks "Add to dataset" and declines to turn datasets on
    Then the add-to-dataset drawer does not open

Rule: Selected rows can be queued again, or moved to another queue

  A reviewed trace sometimes deserves another pass, and a queued one sometimes
  sits in the wrong queue. The all annotations page adds; a queue page moves,
  through the same dialog the rest of the product queues traces with, opened on
  the membership the rows already have so the change is an edit, not a retype.

  Background:
    Given the user is authenticated with "annotations:update" permission
    And the annotations list shows rows

  @integration
  Scenario: The all annotations page offers to add the selection to a queue
    Given rows on the all annotations page are selected
    Then the bar offers "Add to queue"
    And choosing it opens the queue dialog with nothing preselected
    And queueing sends the selected traces to the chosen queue

  @integration
  Scenario: A queue page offers to move the selection instead
    Given rows on a queue page are selected
    Then the bar offers "Move to queue" and not "Add to queue"
    And choosing it opens the queue dialog with this queue already selected

  @integration
  Scenario: Moving the selection re-queues it and leaves this queue
    Given 2 rows on a queue page are selected
    When the user deselects this queue in the dialog, picks another and confirms
    Then those traces are queued for the other queue
    And their items leave this queue

  @integration
  Scenario: Keeping this queue selected adds without removing
    Given rows on a queue page are selected
    When the user keeps this queue selected, adds another and confirms
    Then the traces are queued for the other queue as well
    And their items stay in this queue

Rule: Selected rows can be taken out of the queue

  An item nobody can review is work the reviewer cannot finish, and the queue
  never reads as complete while it is there.

  Background:
    Given the user is authenticated with "annotations:update" permission
    And the annotations list shows rows

  @integration
  Scenario: The selection bar offers to remove the selected items from the queue
    Given rows on a queue page are selected
    Then the bar offers "Remove from queue"

  @integration
  Scenario: Removing the selection takes exactly those queue items out
    Given 2 rows on a queue page are selected
    When the user clicks "Remove from queue"
    Then those 2 queue items are removed
    And the selection is cleared

  @integration
  Scenario: The all annotations page never offers to remove from a queue
    Given rows on the all annotations page are selected
    Then the bar does not offer "Remove from queue"

Rule: A row's own actions live in an overflow menu

  One trailing three-dot trigger per row, so the row stays scannable and the
  destructive action is one deliberate click away.

  Background:
    Given the user is authenticated with "annotations:update" permission
    And the annotations list shows rows

  @integration
  Scenario: Every row carries an overflow menu
    When the annotations list renders
    Then each row ends with an actions menu
    And opening it does not open the row

  @integration
  Scenario: View trace opens the trace drawer with the row's timestamp
    When the user picks "View trace" from a row's menu
    Then the trace drawer opens for that trace
    And it carries the trace's timestamp so the read prunes partitions

  @integration
  Scenario: Add to dataset from a row opens the drawer for that one trace
    When the user picks "Add to dataset" from a row's menu
    Then the add-to-dataset drawer opens with only that row's trace

  @integration
  Scenario: Remove from queue takes that one item out
    When the user picks "Remove from queue" from a row's menu
    Then only that queue item is removed

  @integration
  Scenario: A row with no queue item behind it is never removed from a queue
    Given the row is an annotation on the all annotations page
    When the user opens the row's menu
    Then it offers no "Remove from queue"

Rule: Clicking a row opens what the reviewer needs next

  Background:
    Given the user is authenticated with "annotations:view" permission
    And the annotations list shows rows

  @integration
  Scenario: A pending queue item opens the annotation flow
    When the user clicks a row that is still waiting
    Then the reviewer lands on that queue item in the annotation flow

  @integration
  Scenario: A finished queue item opens the trace drawer
    When the user clicks a row that is already done
    Then the trace drawer opens for that trace

  @integration
  Scenario: A row on the all annotations page opens the trace drawer
    When the user clicks a row on the all annotations page
    Then the trace drawer opens for that trace

Rule: The columns say what the reviewer needs to judge a row

  Background:
    Given the user is authenticated with "annotations:view" permission
    And the annotations list shows rows

  @integration
  Scenario: A queue page dates a row by when it was queued
    When a queue page renders
    Then the date column is titled "Date queued"

  @integration
  Scenario: The all annotations page dates a row by its newest annotation
    When the all annotations page renders
    Then the date column is titled "Date annotated"
    And a row carrying several annotations shows the newest one's date

  @integration
  Scenario: Suggestions are a count chip that opens on hover
    Given a row carries 2 suggestions
    Then the suggestions cell reads "2"
    And hovering it lists each suggestion with its author
    # A suggestion in full is a wall of text; the chip keeps the table
    # scannable and the hover keeps the text one gesture away. There is no
    # expected output column any more.

  @integration
  Scenario: A row with no suggestions shows no chip
    Given a row carries no suggestion
    Then its suggestions cell is empty

  @integration
  Scenario: Comments are a count chip that opens on hover
    Given a row carries 2 comments
    Then the comments cell reads "2"
    And hovering it lists each comment with its author
    And names the part each comment was left on

  @integration
  Scenario: A row with no comments shows no chip
    Given a row carries no comment
    Then its comments cell is empty

  # A project that collects a dozen score types used to get a dozen columns,
  # nearly all empty on any given row, which squeezed input and output into a
  # strip and pushed the row's actions off the right edge.
  @integration
  Scenario: Every score is folded into one Scores column
    Given the project has two active score types and one inactive one
    Then the table carries one "Scores" column and no column per score type
    And a score shows there as its type's name and the answer given
    And every row has exactly one cell per column

  @integration
  Scenario: A score type can be given its own column
    Given the project has two active score types
    When the reviewer picks one of them in the columns menu
    Then the table carries a column for that score type only
    And every row has exactly one cell per column

  @integration
  Scenario: Score types that are all inactive add no columns
    Given the project has score types and none of them is active
    Then the table carries no score column
    And the columns menu offers none of them
    And every row has exactly as many cells as the header has columns

Rule: The inbox can be narrowed to the queues being worked on

  The inbox pools every queue the reviewer belongs to, which is what makes its
  pending count trustworthy and its list a mix nobody asked for. The pick only
  ever narrows: it is applied on top of the reach the reviewer already has, so
  a queue id from anywhere else can subtract rows but never add one.

  Background:
    Given the user is authenticated with "annotations:view" permission
    And the reviewer belongs to two queues

  @integration
  Scenario: The inbox reads every queue until one is picked
    When the inbox renders
    Then the queue control reads "All"
    And the read asks for no particular queue

  @integration
  Scenario: The inbox narrows to the queues the reviewer picks
    When the reviewer picks one queue
    Then the read asks for that queue only
    And the queue control names it

  @integration
  Scenario: A page that is one queue offers no queue filter
    When a single queue's page renders
    Then it carries no queue filter

  @unit
  Scenario: A picked queue cannot widen what the reviewer may read
    Given the reviewer may read only their own items
    When they pick a queue they do not belong to
    Then the read still asks only for their own items

Rule: The reviewer chooses which columns the list shows

  The list is read differently by different people, and one project's score
  types are another's noise. The choice is per project and kept in the browser:
  it is how one person likes to read the list, not something the project agrees
  on.

  Background:
    Given the user is authenticated with "annotations:view" permission
    And the annotations list shows rows

  @integration
  Scenario: A column the reviewer hides stays hidden
    When the reviewer turns a column off in the columns menu
    Then the table stops carrying it
    And it is still off when they come back to the list

  @integration
  Scenario: A column added after the reviewer chose still appears
    Given the reviewer has hidden a column
    When the project gains a column that shows by default
    Then that new column shows

Rule: The row's actions are always within reach

  Background:
    Given the user is authenticated with "annotations:update" permission
    And the annotations list shows rows

  # Unpinned, the overflow menu is the last column of a table that can be wider
  # than the page, so "View trace" and "Remove from queue" sit off screen behind
  # a sideways scroll nobody thinks to make.
  @integration
  Scenario: The row's actions stay reachable however wide the table is
    When the annotations list renders
    Then the actions column is pinned to the edge of the table's own scroll

  @integration
  Scenario: Input and output stay behind the redaction marker
    When the annotations list renders
    Then the input and output cells are wrapped in the redaction marker

Rule: Every page carries the same header controls

  Background:
    Given the user is authenticated with "annotations:view" permission
    And the annotations list shows rows

  @integration
  Scenario: A queue page filters by status
    When a queue page renders
    Then the header offers Pending, Completed and All
    And the control names the status it is filtering by

  @integration
  Scenario: The all annotations page has no status filter
    When the all annotations page renders
    Then the header offers no status filter

  @integration
  Scenario: The header controls sit outside the sideways-scrolling region
    When the annotations list renders
    Then only the table scrolls sideways
    And the status filter and the export control are outside that region

  # A queue is work still to do and the sidebar badge counts all of it, so a
  # window nobody asked for would leave the badge and the list disagreeing.
  @integration
  Scenario: A queue page lists every pending item until a range is picked
    Given a pending item was queued long ago
    And the reviewer has picked no date range
    When the queue page reads its items
    Then the read asks for no date range
    And that item is listed
    And the date control reads "All time"

  @integration
  Scenario: A picked date range narrows a queue page to when items were queued
    Given queue items created inside and outside the picked range
    When the queue page reads its items for that range
    Then only the items queued inside the range come back

  @integration
  Scenario: A queue page can be put back to All time
    Given the reviewer picked a date range on a queue page
    When they pick "All time"
    Then the range is taken back off
    And the page lists every pending item again

  @integration
  Scenario: The all annotations page keeps its own date range
    Given the reviewer has picked no date range
    Then the all annotations page still reads its own default window
    And its date control names that window
    And it offers no "All time" choice

  @integration
  Scenario: A queue page exports the rows on screen
    When the user exports from a queue page
    Then the file holds one line per row on screen
    And the columns are the ones the table shows

  @integration
  Scenario: The all annotations page exports everything it holds
    When the user exports from the all annotations page
    Then the file holds every annotation the page loaded

Rule: The sidebar says which list is open

  Background:
    Given the user is authenticated with "annotations:view" permission

  @integration
  Scenario: The open queue is the highlighted sidebar entry
    Given the reviewer is reading a queue
    Then that queue is the highlighted entry
    And no other queue is highlighted

  @integration
  Scenario: The open top-level list is the highlighted sidebar entry
    Given the reviewer is reading the all annotations page
    Then "All" is the highlighted entry
    And the inbox is not highlighted

Rule: A queue is edited from the sidebar entry that names it

  Editing a queue is about the queue, not about the rows on screen, so the
  action belongs to the queue wherever it is listed rather than to the header
  of that one queue's page.

  Background:
    Given the user is authenticated with "annotations:view" permission

  @integration
  Scenario: Every queue in the sidebar carries its own actions menu
    When the sidebar lists the reviewer's queues
    Then each queue offers an actions menu
    And picking "Edit queue" opens the edit drawer for that queue

  @integration
  Scenario: A queue page header offers no queue actions
    When a queue page renders
    Then its header carries no queue actions menu

  @integration
  Scenario: A member who cannot change resources is offered no queue actions
    Given the reviewer cannot change resources
    When the sidebar lists their queues
    Then no queue offers an actions menu

Rule: The all annotations page pages through its rows

  The page groups every annotation it loaded, so the pager has to slice them
  rather than decorate a single long list.

  Background:
    Given the user is authenticated with "annotations:view" permission

  @integration
  Scenario: Only one page of grouped annotations is shown at a time
    Given the page holds more grouped annotations than fit on a page
    When the page renders
    Then it shows only the first page of them
    And moving to the next page shows the next slice
