# Implementation:
#   platform/app/src/pages/[project]/annotations/my-queue.tsx     (queue walk, bottom bar, end-of-queue hand-off)
#   platform/app/src/components/messages/MessageHoverActions.tsx  (suggest a correction from the conversation)
#   platform/app/src/components/AnnotationExpectedOutputs.tsx     (saved suggestions under the output)
#   platform/app/src/components/AddDatasetRecordDrawer.tsx        (the drawer the hand-off opens)
#   platform/app/src/server/api/routers/annotation.ts             (queue marks, mark clearing)
#
# Motivation: the reviewer's loop is production traces, then correction, then an
# evaluation dataset. Walking a queue used to end nowhere. The only way to get
# the traces just reviewed into a dataset was a CSV export of everything
# followed by a manual import, and the queue bar itself was a row of bare
# glyphs whose meaning had to be guessed.
#
# Decisions:
#   - The mark lives on the queue item in the database rather than in the
#     browser, so it survives a refresh, is visible to whoever picks the queue
#     up next, and can still be found after the item is done.
#   - The hand-off is offered once per set of marks. Dismissing it is an answer,
#     so it is not offered again until the marks themselves change.
#   - Correcting a trace happens in the trace drawer opened straight into edit
#     mode, not in a second editor bolted onto the queue page. The dataset reads
#     the correction, so what the reviewer fixed is what the dataset gets.
#   - Suggesting a better output is a correction too, so it opens the same
#     correction popover the trace drawer uses instead of a separate inline
#     textarea whose only save button lived in another column.

Feature: Walking an annotation queue into a dataset
  As a reviewer working through my annotation queue
  I want to correct traces as I go and mark the good ones
  So that finishing the queue hands exactly those traces to a dataset

  Background:
    Given I am signed in to a project with permission to update annotations
    And my queue has items waiting for me

  Rule: The queue bar names every action it offers

    @integration
    Scenario: The queue bar labels its navigation and actions in words
      When I open a queue item
      Then the bar offers "Previous", "Next", "Edit trace" and "Done"
      And none of them is an unlabelled icon

    @integration
    Scenario: The queue bar shows my position in the queue
      Given my queue has 3 items waiting
      When I open the second one
      Then the bar reads "2 of 3"

  Rule: The trace behind a queue item is corrected in the trace drawer

    @integration
    Scenario: Edit trace opens the trace drawer already in edit mode
      When I choose "Edit trace" on a queue item
      Then the trace drawer opens on that item's trace
      And it is already in edit mode, so I can correct the trace without a second click

  Rule: Items are marked for the dataset while the queue is walked

    @integration
    Scenario: Ticking the end-of-queue checkbox marks the open item
      Given the open queue item is not marked
      When I tick "Add to dataset at the end"
      Then the item is marked for the dataset

    @integration
    Scenario: The checkbox answers immediately, before the mark is stored
      Given the open queue item is not marked
      When I tick "Add to dataset at the end" and the store has not answered yet
      Then the checkbox already reads as ticked

    @integration
    Scenario: Unticking the checkbox takes the mark off the item
      Given the open queue item is marked
      When I untick "Add to dataset at the end"
      Then the mark is taken off the item

    @integration
    Scenario: A mark made earlier is still ticked when the queue is reopened
      Given a queue item I marked in an earlier session
      When I open it again
      Then "Add to dataset at the end" is already ticked

  Rule: Finishing the queue hands the marked traces to a dataset

    @integration
    Scenario: Finishing the last item opens the dataset drawer with the marked traces
      Given the last item of my queue is open and two items are marked
      When I mark it done
      Then the add-to-dataset drawer opens with those two traces

    @integration
    Scenario: Traces marked before they were finished are part of the hand-off
      Given I marked an item and then finished it earlier in this queue walk
      When I finish the last item
      Then the hand-off still includes that trace

    @integration
    Scenario: Finishing the last item with nothing marked skips the hand-off
      Given nothing in my queue is marked
      When I finish the last item
      Then no drawer opens and I land on the finished queue

    @integration
    Scenario: Opening a finished queue that still has marks offers the hand-off
      Given every item in my queue is done and two of them are marked
      When I open my queue
      Then the add-to-dataset drawer opens with those two traces

    @integration
    Scenario: Adding the traces to a dataset takes the marks off
      Given the hand-off drawer is open for two marked items
      When the records are added to a dataset
      Then the marks are cleared from those queue items

    @integration
    Scenario: Dismissing the hand-off does not offer it again until the marks change
      Given I dismissed the hand-off drawer without adding anything
      When the queue re-renders with the same marks
      Then the drawer is not opened again
      And it is offered again once the set of marked items changes

  Rule: A better output is suggested through the correction popover

    @integration
    Scenario: The suggest action on a queued message opens the correction popover
      When I use the suggest action on a message
      Then the correction popover opens for that message's trace
      And no correction draft is seeded into the comment sidebar

    @integration
    Scenario: Saved suggestions are listed under the output without an editor
      Given a message whose trace already carries two suggestions
      Then both are listed under the output with their author
      And neither is an editable field sitting in the page

    @integration
    Scenario: Picking a saved suggestion reopens it in the correction popover
      Given a message whose trace already carries a suggestion
      When I pick that suggestion
      Then the correction popover opens on it for editing
