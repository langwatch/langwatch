Feature: Walking an annotation queue into a dataset
  A reviewer works through queued traces, records corrections, and can hand the
  traces chosen during that sitting to a dataset.

  Background:
    Given I am signed in to a project with annotation access
    And my queue has items waiting for me

  Rule: Queue navigation finishes one item at a time

    @integration
    Scenario: The queue bar has one labelled forward action
      When I open a non-final queue item
      Then the bar offers "Previous", "Edit trace" and "Next"
      And choosing "Next" records the item as done and opens the next item
      And there is no second forward action

    @integration
    Scenario: The final action is explicit
      Given the last item of my queue is open
      Then the primary action reads "Done"
      And the bar shows my position in the queue

    @integration
    Scenario: Navigation does not leave work after the page
      When I move to another item and leave the queue before it settles
      Then no pending navigation updates the page

  Rule: The reviewer can recognize and correct the trace under review

    @integration
    Scenario: The current turn is focused in its conversation
      Given a queued trace belongs to a multi-turn conversation
      When I open the queue item
      Then the conversation scrolls to that turn and briefly identifies it
      And the current turn remains distinct while I scroll
      And the annotation rail does not move the turns around it

    @integration
    Scenario: A single or unavailable conversation still shows the queued trace
      Given the queued trace has no thread or its thread is outside the read window
      When I open the queue item
      Then that trace is shown as a single-turn conversation

    @integration
    Scenario: Messages arrive expanded so the whole output can be read
      When I open a queue item
      Then the conversation's messages are already expanded
      And nothing is cut off mid-answer for the reviewer to unfold by hand

    @integration
    Scenario: Edit trace uses the trace drawer in annotation mode
      Given I may update annotations
      When I choose "Edit trace"
      Then the drawer opens for the queued trace in annotation mode
      And it avoids a duplicate conversation tab when the queue already shows it

    @integration
    Scenario: A reviewer who cannot update annotations is offered no correction
      Given I may work my queue but not update its annotations
      When I open a queue item
      Then no way to edit the trace is offered, on the bar or on a turn
      And the rest of the bar still works

    @integration
    Scenario: Picking another turn opens that turn's trace in the drawer
      Given the open queue item's thread has more than one turn
      When I pick one of the other turns
      Then that turn's trace opens in the trace drawer over the queue

    @integration
    Scenario: Annotation suggestions use the conversation correction editor
      When I open a queue item
      Then each visible turn can offer a better output through its correction editor
      And the queue page supplies no separate suggestion editor

  Rule: Session marks are local to this queue visit

    @integration
    Scenario: Reviewing and explicitly selecting traces builds the dataset set
      Given a trace is under review
      Then it starts selected for this session
      And annotating another turn selects its trace
      And I can explicitly select or deselect every trace
      And an explicit deselection wins over automatic selection

    @integration
    Scenario: The dataset toggle reports usable selections
      Given three traces are selected in this session
      Then the bar says "Add to dataset at the end (3 traces)"
      And the toggle is disabled when no traces are selected

    @integration
    Scenario: Leaving clears the session selection
      Given traces are selected during this queue visit
      When I leave and open the queue again
      Then no trace is still selected from the earlier visit

  Rule: Completing the last item handles the dataset hand-off before celebration

    @integration
    Scenario: A selected hand-off remains over the conversation until it resolves
      Given the last item is open, selected traces exist, and the dataset toggle is on
      When I choose "Done"
      Then the dataset drawer opens for those traces over the conversation
      And the item is not done and no completion screen is shown yet

    @integration
    Scenario: Completing or confirming without a dataset ends the session
      Given the final dataset hand-off is open
      When I add the records or confirm ending without them
      Then the item is done, the session selection is cleared, and completion is shown

    @integration
    Scenario: Cancelling a hand-off leaves the final item and selections intact
      Given I dismiss the hand-off without adding records
      When I cancel the confirmation to end without a dataset
      Then the conversation remains open and the final item is not done

  Rule: A missing trace can never trap or expose another reviewer's work

    @integration
    Scenario: An unavailable trace can be skipped or removed
      Given the queued trace no longer resolves
      When I open its item
      Then I am told it is unavailable and can "Remove from queue" or "Skip"
      And no annotation or correction action is offered

    @integration
    Scenario: Queue mutations are limited to the reviewer's reachable items
      Given an item belongs only to a teammate or an unrelated queue
      When I try to finish or remove it
      Then the item remains unchanged
