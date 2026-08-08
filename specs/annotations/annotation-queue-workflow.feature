# Implementation:
#   platform/app/src/pages/[project]/annotations/my-queue.tsx     (queue walk, bottom bar, end-of-queue hand-off)
#   platform/app/src/features/traces-v2/components/TraceDrawer/conversationView/ConversationView.tsx
#                                                                 (the conversation the reviewer reads and corrects)
#   platform/app/src/features/traces-v2/utils/legacyTraceToTurn.ts (a threadless trace read as a single-turn conversation)
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
#   - The queue reads the thread through the same conversation view the trace
#     drawer uses, so annotating, suggesting, translating and expanding a
#     message work the same way wherever the reviewer meets the conversation.
#     The conversation owns the scroll; the page around it does not, so the
#     bar stays put and the turns scroll under it.
#   - Suggesting a better output is a correction too, so it is offered on the
#     turn being read and opens the conversation's own correction editor,
#     instead of a separate inline textarea whose only save button lived in
#     another column.

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

    # Moving on settles a beat after the route resolves, so the bar does not
    # flicker back before the next item renders. Leaving inside that beat used
    # to leave the wait running against a page that no longer existed.
    @integration
    Scenario: Leaving mid-navigation leaves nothing pending behind
      Given I have moved on to the next item
      When I leave the queue before it settles
      Then nothing is left waiting to settle the page

  Rule: The trace behind a queue item is corrected in the trace drawer

    @integration
    Scenario: Edit trace opens the trace drawer already in edit mode
      When I choose "Edit trace" on a queue item
      Then the trace drawer opens on that item's trace
      And it is already in edit mode, so I can correct the trace without a second click

    @integration
    Scenario: A reviewer who cannot update annotations is offered no correction
      Given I may work my queue but not update its annotations
      When I open a queue item
      Then the bar offers no way to edit the trace
      And the rest of the bar still works

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

  Rule: What is marked is read apart from the queue itself

    @integration
    Scenario: Marks outlive being done and are read without their traces
      Given I marked two items and finished one of them
      When the marked items are read
      Then both are listed, each with its trace and when it was marked
      And nothing else about them is read

    @integration
    Scenario: A teammate's marks are not part of my hand-off
      Given a teammate marked an item that is assigned to them alone
      When the marked items are read
      Then that item is not among them

  Rule: An item whose trace is gone is walked past, not stared at

    # A queued trace can stop resolving: it was queued from a selection that
    # held ids no trace ever answered to, or it aged out of what the project
    # keeps. There is nothing to annotate on such an item, so the reviewer is
    # told so and given a way on instead of an empty conversation and no bar.

    @integration
    Scenario: An item whose trace is gone says so and offers a way on
      Given the trace behind the open queue item no longer resolves
      When I open that queue item
      Then I am told the queued trace is no longer available
      And I am offered "Remove from queue" and "Skip"
      And the bar still reads my position and offers "Previous" and "Next"
      And nothing is offered for annotating or correcting it

    @integration
    Scenario: Removing an item whose trace is gone takes it out of the queue
      Given the trace behind the open queue item no longer resolves
      When I choose "Remove from queue"
      Then that item is removed from my queue
      And the queue moves on to the next item

    @integration
    Scenario: Skipping an item whose trace is gone leaves it in the queue
      Given the trace behind the open queue item no longer resolves
      When I choose "Skip"
      Then the queue moves on to the next item
      And that item is still in my queue

    @integration
    Scenario: Removing a teammate's queue item is refused
      Given an item assigned to a teammate alone
      When I remove it from my queue
      Then nothing is removed

    @integration
    Scenario: An item whose trace is gone does not hold the finished queue back
      Given every item I can read is done and one item's trace no longer resolves
      When I open my queue
      Then I am told all tasks are complete

    @integration
    Scenario: An item whose trace is gone does not hold the dataset hand-off back
      Given every item I can read is done, two are marked, and one item's trace no longer resolves
      When I open my queue
      Then the add-to-dataset drawer opens with those two traces

  Rule: The queue reads its trace as a conversation

    @integration
    Scenario: A queued trace is read as the whole thread it belongs to
      Given the trace behind the open queue item belongs to a thread
      When I open that queue item
      Then that thread's turns are rendered as a conversation
      And the turn under review is the one marked as current

    @integration
    Scenario: Messages arrive expanded so the whole output can be read
      When I open a queue item
      Then the conversation's messages are already expanded
      And nothing is cut off mid-answer for the reviewer to unfold by hand

    @integration
    Scenario: A trace with no thread is still read as a conversation
      Given the trace behind the open queue item carries no thread id
      When I open that queue item
      Then that trace alone is rendered as a single-turn conversation
      And I am told to pass the thread_id to capture the whole conversation

    # The conversation reads a 90-day window, so a thread older than that comes
    # back empty even though the item's own trace loaded fine. Reading it as an
    # empty conversation would hide the very turn the reviewer was sent here for.
    @integration
    Scenario: A trace whose thread is older than the conversation window is read on its own
      Given the trace behind the open queue item carries a thread id
      And the conversation has settled with no turns in it
      When I open that queue item
      Then that trace alone is rendered as the turn under review

    @integration
    Scenario: Picking another turn opens that turn's trace in the drawer
      Given the open queue item's thread has more than one turn
      When I pick one of the other turns
      Then that turn's trace opens in the trace drawer over the queue

  Rule: A better output is suggested through the conversation's correction editor

    @integration
    Scenario: Suggesting is offered on the turn being read
      When I open a queue item
      Then suggesting a better output is offered by the conversation on each turn
      And the page holds no editor of its own for me to hunt for

      # A turn that already carries a suggestion is marked as corrected in the
      # conversation itself. The saved-suggestion list under a message belongs
      # to the legacy conversation on the trace details Thread tab, and is
      # specified in specs/traces-v2/annotations.feature.

  Rule: Finishing an item only ever finishes the reviewer's own work

    Marking done clears work off a queue. A reviewer reaches the items assigned
    to them and the items in queues they belong to, so an id from anywhere else
    finishes nothing.

    @integration
    Scenario: A reviewer finishes an item on their own queue
      Given an item assigned to me
      When I mark it done
      Then it is recorded as done

    @integration
    Scenario: Finishing a teammate's queue item is refused
      Given an item assigned to a teammate I share no queue with
      When I mark it done
      Then it is refused
      And the item is still waiting
