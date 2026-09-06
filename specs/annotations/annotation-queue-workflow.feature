# Implementation:
#   platform/app/src/pages/[project]/annotations/my-queue.tsx     (queue walk, bottom bar, end-of-queue hand-off)
#   platform/app/src/features/traces-v2/components/TraceDrawer/conversationView/ConversationView.tsx
#                                                                 (the conversation the reviewer reads and corrects,
#                                                                  and the turn in focus)
#   platform/app/src/features/traces-v2/stores/                   (the session's traces, collected as the queue is walked)
#   platform/app/src/features/traces-v2/utils/legacyTraceToTurn.ts (a threadless trace read as a single-turn conversation)
#   platform/app/src/components/AnnotationExpectedOutputs.tsx     (saved suggestions under the output)
#   platform/app/src/components/AddDatasetRecordDrawer.tsx        (the drawer the hand-off opens)
#
# Motivation: the reviewer's loop is production traces, then correction, then an
# evaluation dataset. Walking a queue used to end nowhere. The only way to get
# the traces just reviewed into a dataset was a CSV export of everything
# followed by a manual import, and the queue bar itself was a row of bare
# glyphs whose meaning had to be guessed. And once the queue read whole threads,
# the page stopped saying which turn the item was actually about, and the
# celebration fired the moment the counter hit zero, before the dataset
# hand-off it was supposed to crown.
#
# Decisions:
#   - The session's traces live in the browser for the sitting, not on the queue
#     item in the database. A reviewer walks a thread and annotates whichever
#     turns deserve it; which of those go to a dataset is a decision about this
#     sitting, made at its end. Leaving the queue ends the sitting and clears
#     the set.
#   - Annotating a turn counts it into the session automatically, because a
#     turn worth writing about is a turn worth keeping; the reviewer's own
#     tick or untick always wins over the automatic one.
#   - The turn the reviewer was sent to is counted into the session from the
#     start: walking the queue is what the sitting is, so its own traces are in
#     unless the reviewer says otherwise.
#   - The bar's "Add to dataset at the end" stays a decision, not a display: it
#     is the on/off switch for the hand-off, and it carries the live count of
#     the session's traces so the end of the queue is never a surprise. With
#     nothing counted there is nothing to decide about, so it is disabled.
#   - One way forward. The bar's primary action is "Next", which finishes the
#     item and moves on; on the last item it reads "Done". A second, non-
#     finishing forward button earned its keep by being confused with it.
#   - The celebration is earned, not automatic. It shows after the dataset add
#     succeeds, or after the reviewer explicitly confirms ending the session
#     without one. It never shows under or before the hand-off drawer, and no
#     finished-queue screen ever replaces the conversation: the hand-off plays
#     out over what the reviewer was reading, and until it resolves the last
#     item is not finished, so cancelling lands back on it, checkboxes intact.
#   - The turn the item is about announces itself: the conversation scrolls to
#     it, blinks it once, and keeps a tint on it, because "which turn was I
#     sent here for" must survive the reviewer scrolling around.
#   - Correcting a trace happens in the trace drawer opened straight into edit
#     mode, not in a second editor bolted onto the queue page. The dataset reads
#     the correction, so what the reviewer fixed is what the dataset gets. The
#     drawer opens on a tab that adds something: the queue page already shows
#     the conversation, so the drawer never opens on the conversation tab from
#     here.
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

  Rule: The queue bar names every action it offers, and moving forward is finishing

    One way forward: the primary action finishes the item and moves on, so the
    bar never offers two forward buttons whose difference has to be guessed.

    @integration
    Scenario: The queue bar labels its navigation and actions in words
      When I open a queue item
      Then the bar offers "Previous", "Edit trace" and "Next"
      And none of them is an unlabelled icon

    @integration
    Scenario: Next finishes the item and moves on
      Given my queue has items after this one
      When I choose "Next"
      Then the item is recorded as done
      And the queue moves on to the next item
      And the bar offers no second way forward

    @integration
    Scenario: The last item's primary action reads Done
      Given the last item of my queue is open
      Then the bar's primary action reads "Done" instead of "Next"

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
    Scenario: Edit trace opens the trace drawer already in annotation mode
      When I choose "Edit trace" on a queue item
      Then the trace drawer opens on that item's trace
      And it is already in annotation mode, so I can correct the trace without a second click

    @integration
    Scenario: Edit trace falls back from the conversation tab to the summary tab
      Given the drawer last showed me the conversation tab
      When I choose "Edit trace" on a queue item
      Then the drawer opens on the summary tab
      And the tab I usually get elsewhere is unchanged
      # The queue page already shows the conversation; opening the drawer onto
      # a second copy of it says nothing new.

    @integration
    Scenario: A reviewer who cannot update annotations is offered no correction
      Given I may work my queue but not update its annotations
      When I open a queue item
      Then the bar offers no way to edit the trace
      And the rest of the bar still works

  Rule: The turn under review is unmistakable

    @integration
    Scenario: Opening a queue item scrolls its turn into view
      Given the open queue item's thread has more turns than fit on screen
      When I open that queue item
      Then the conversation scrolls to the item's own turn
      And that turn blinks once so my eye lands on it

    # Scrolling the instant the thread renders reads as landing on a fragment.
    # Resting first shows the reviewer they are in a conversation; the carry to
    # the turn is then legible as movement within it.
    @integration
    Scenario: The scroll waits a beat so the conversation is seen first
      Given the open queue item's thread has more turns than fit on screen
      When I open that queue item
      Then the conversation first rests where it loaded
      And only after a moment does it carry me to the item's turn

    @integration
    Scenario: The turn under review keeps a distinct background
      When I open a queue item and scroll the conversation myself
      Then the item's own turn still reads with a distinct background tint
      And no other turn reads that way

    @integration
    Scenario: The tint hugs the turn and leaves the rail out
      Given the item's own turn carries annotations in the rail beside it
      Then the tint wraps the turn's messages with a little breathing room
      And the annotation rail beside the turn stays outside the tint
      And the turns around it keep their exact place
      # The breathing room comes out of the tint's own edges, not the layout:
      # a focused turn must not push its neighbours around.

    @integration
    Scenario: The only turn of a conversation is not tinted
      Given the open queue item's trace is the conversation's only turn
      Then no tint is drawn on it
      # A highlight that points at the only thing on screen says nothing.

    @integration
    Scenario: Moving to the next item moves the focus
      Given my queue has two items in the same thread
      When I move from one to the next
      Then the conversation scrolls to the next item's turn
      And the distinct background moves with it

  Rule: The session's traces are collected as the queue is walked

    Each turn's session checkbox leads its separator, on the left, where ticked
    state is scanned down a list; the separator's own actions keep the right.

    @integration
    Scenario: The turn under review is counted from the start
      When I open a queue item
      Then that turn's checkbox is already ticked
      And the bar's dataset toggle counts one trace
      # The queue sent the reviewer to this trace; the sitting starts from it.

    @integration
    Scenario: The session checkbox leads the separator
      When I open a queue item
      Then each turn's session checkbox sits at the left end of its separator

    @integration
    Scenario: Annotating a turn counts its trace into the session
      Given a turn the session does not count yet
      When I annotate it
      Then that turn's checkbox reads as ticked
      And the bar's count goes up by one

    @integration
    Scenario: A turn is counted in or out by hand
      Given a turn the session does not count yet
      When I tick that turn's checkbox
      Then the bar's count goes up by one
      And unticking a turn I annotated takes it back out, and my untick wins

    @integration
    Scenario: A counted turn's separator reads as counted
      Given a turn the session does not count yet
      When I tick that turn's checkbox
      Then its separator reads the way the turn under review does
      And unticking it puts the separator back
      # A tick alone is a small thing to find again on a long conversation.

    @integration
    Scenario: The dataset toggle carries the live count in traces
      Given three turns are counted into the session
      Then the bar reads "Add to dataset at the end (3 traces)"
      And with one counted it reads "Add to dataset at the end (1 trace)"

    @integration
    Scenario: An empty session disables the dataset toggle
      Given I have unticked every counted turn
      Then the bar's dataset toggle is disabled
      And it cannot be ticked until a turn is counted again

    @integration
    Scenario: Session marks belong to the sitting
      Given two turns are counted into the session
      When I leave the queue and open it again
      Then no turn is counted any more
      # Which traces to keep is a decision about one sitting; a stale set from
      # last week silently feeding a dataset would be worse than re-ticking.

  Rule: Finishing the queue hands the session's traces to a dataset, then celebrates

    The conversation being read is the whole end of the queue. Done on the last
    item plays the hand-off out over it: no finished-queue screen replaces it,
    and the reviewer leaves it only for the celebration, once the records are
    added or ending without them is confirmed. Until then the item is not
    finished either, so cancelling lands back on the same item with its
    checkboxes still in reach.

    @integration
    Scenario: Finishing the last item opens the hand-off over the conversation
      Given the last item of my queue is open, two traces are counted, and the dataset toggle is on
      When I choose "Done"
      Then the add-to-dataset drawer opens with those two traces
      And the conversation I was reading is still behind it
      And the celebration is not shown yet
      And no screen says the queue is finished

    @integration
    Scenario: Traces counted earlier in the walk are part of the hand-off
      Given I annotated a turn and finished its item earlier in this sitting
      When I finish the last item
      Then the hand-off still includes that trace

    @integration
    Scenario: The celebration shows once the records are added
      Given the hand-off drawer is open for the session's traces
      When the records are added to a dataset
      Then the last item is recorded as done
      And I am told all tasks are complete
      And the session's set is cleared

    @integration
    Scenario: Closing the hand-off without adding asks before ending the session
      Given the hand-off drawer is open for the session's traces
      When I close it without adding anything
      Then I am asked "Are you sure you want to end this annotation session without adding to a dataset?"
      And confirming records the item as done and shows the celebration

    @integration
    Scenario: Cancelling the question lands back on the conversation, nothing finished
      Given I was asked about ending the session without a dataset
      When I cancel
      Then the question closes and the conversation I was reading is still there
      And the last item is not recorded as done
      And every counted trace is still counted, so I can untick turns before finishing again
      And choosing "Done" again offers the hand-off again

    @integration
    Scenario: Finishing with the dataset toggle off celebrates directly
      Given the last item of my queue is open and the dataset toggle is off
      When I choose "Done"
      Then no drawer opens
      And the item is recorded as done
      And I am told all tasks are complete

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
      And no integration hint about thread ids interrupts the reading

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
