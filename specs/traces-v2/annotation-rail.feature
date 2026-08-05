# Inline annotation rail beside the conversation
#
# Implementation:
#   platform/app/src/features/traces-v2/stores/annotationDraftStore.ts
#   platform/app/src/features/traces-v2/hooks/useConversationAnnotations.ts
#   platform/app/src/features/traces-v2/components/TraceDrawer/conversationView/useRailLayout.ts
#   platform/app/src/features/traces-v2/components/TraceDrawer/conversationView/AnnotatedTurnRow.tsx
#   platform/app/src/features/traces-v2/components/TraceDrawer/conversationView/TurnAnnotationRail.tsx
#   platform/app/src/features/traces-v2/components/TraceDrawer/conversationView/AnnotationCard.tsx
#   platform/app/src/features/traces-v2/components/TraceDrawer/conversationView/AnnotationEditorCard.tsx
#
# Motivation: annotations used to hide behind a separate sub-tab of the
# Conversation view, so a reviewer had to leave the conversation to read what
# anyone had said about it, and there was no way to see a note next to the turn
# it was about. The rail puts every turn's annotations beside that turn, where
# the annotation queue has always put them, and lets the reviewer write one in
# the same place instead of in a popover floating over the text.

Feature: Annotation rail beside each conversation turn

  Background:
    Given the user is authenticated with "annotations:view" permission
    And the conversation is shown in thread layout

  Rule: The rail only exists when there is something to put in it

    Nothing reserves space for a rail on a conversation nobody has annotated.
    The column appears the moment there is a card or a composer to hold.

    @unit
    Scenario: A conversation with no annotations and no open composer has no rail
      Given no turn in the conversation carries an annotation
      And no annotation is being written
      Then the conversation reserves no room for a rail

    @unit
    Scenario: Starting an annotation on a turn opens the rail
      Given no turn in the conversation carries an annotation
      When the reviewer starts an annotation on one of its turns
      Then the rail opens for the conversation

    @unit
    Scenario: An annotation on any turn opens the rail for the whole conversation
      Given one turn in the conversation carries an annotation
      Then the rail opens for the conversation
      # Every turn then gets its own rail area, empty ones included, so the
      # message column keeps one width down the whole thread.

    @unit
    Scenario: A composer opened on another conversation leaves this rail closed
      Given the reviewer is writing an annotation on a turn of another conversation
      And no turn of this conversation carries an annotation
      Then this conversation reserves no room for a rail
      # The queue page and the trace drawer can both be showing a conversation
      # at once, and only the one being annotated should change shape.

    @unit
    Scenario: Bubbles layout keeps its inline annotation actions
      Given the conversation is shown in bubbles layout
      And one turn in the conversation carries an annotation
      Then no rail is opened

    @integration
    Scenario: A turn renders unchanged while the rail is closed
      Given the rail is closed
      Then the turn renders as the conversation's only column

  Rule: The rail squeezes the message column before it moves

    Reading a turn next to its annotations beats reading it above them, so the
    side layout is held onto as long as both columns are still usable.

    @unit
    Scenario: A wide conversation pane gives the rail its full width
      Given the conversation pane is 1200 pixels wide
      Then the rail sits beside the turn at its full width

    @unit
    Scenario: A narrowing pane slims the rail before moving it
      Given the conversation pane is 720 pixels wide
      Then the rail still sits beside the turn
      And the rail takes its slim width

    @unit
    Scenario: A pane too narrow for two columns stacks the rail under the turn
      Given the conversation pane is 560 pixels wide
      Then the rail is stacked under the turn

    @integration
    Scenario: The rail sits to the right of the turn it belongs to
      Given the rail is open and the pane is wide
      Then the turn is rendered before its rail

    @integration
    Scenario: A stacked rail is indented to line up with the message text
      Given the pane is too narrow for two columns
      Then the rail renders under the turn, inset to the message text

  Rule: The rail area beside a turn is where annotating starts

    @integration
    Scenario: Clicking the empty rail beside a turn starts an annotation on it
      Given the turn carries no annotation yet
      When the reviewer clicks the empty rail beside it
      Then a composer opens in the rail for that turn

    @integration
    Scenario: Clicking an annotation does not start a second one
      Given the turn carries an annotation
      When the reviewer clicks that annotation
      Then no new composer is opened for the turn

    @integration
    Scenario: The turn's own annotate action writes in the rail
      When the reviewer uses the turn's annotate action
      Then the composer opens in the rail rather than over the conversation
      # Bubbles layout has no rail and keeps its popover, which is specified in
      # specs/traces-v2/annotations.feature.

    @unit
    Scenario: Only one annotation is composed at a time
      Given the reviewer is writing an annotation on one turn
      When they start an annotation on another turn
      Then the first composer is replaced by the second

    @unit
    Scenario: A suggestion starts from the turn's current output
      When the reviewer starts a suggestion on a turn
      Then the expected output starts as the turn's current output
      # Same starting point as the popover, so a correction is always an edit
      # of what the model actually said.

    @unit
    Scenario: Closing the composer discards what was typed
      Given the reviewer has typed a comment they have not saved
      When they close the composer
      Then the comment is discarded

  Rule: What is being written survives the turn leaving the screen

    A long conversation renders only the turns on screen, so a composer inside
    a turn is unmounted the moment the reviewer scrolls away from it. What they
    typed lives outside the turn and comes back with it.

    @integration
    Scenario: Typed text survives the turn scrolling out of view
      Given the reviewer has typed a comment in the rail composer
      When the turn is unmounted and rendered again
      Then the composer still holds the typed comment

  Rule: A reviewer edits their own annotations and reads everyone else's

    @integration
    Scenario: The reviewer's own annotation offers to be edited
      Given the turn carries an annotation the reviewer wrote
      Then the annotation offers an edit affordance

    @integration
    Scenario: Another reviewer's annotation is read-only
      Given the turn carries an annotation somebody else wrote
      Then the annotation offers no edit affordance

    @integration
    Scenario: Editing an annotation opens the composer where the annotation sits
      Given the turn carries an annotation the reviewer wrote
      When the reviewer edits it
      Then a composer opens in the rail carrying that annotation's comment
      And the composer offers to delete the annotation

  Rule: A card shows everything the annotation carries

    @integration
    Scenario: An annotation shows its author, when it was written, and its comment
      Given the turn carries an annotation with a comment
      Then the card shows the author's name, the time it was written, and the comment

    @integration
    Scenario: A rating shows the thumb it was given
      Given the turn carries a thumbs-up annotation and a thumbs-down annotation
      Then each card shows the thumb it was rated with
      And an unrated annotation shows neither thumb

    @integration
    Scenario: Scores show their name, their value, and the reason behind them
      Given the turn carries an annotation scored on a key with a reason
      Then the card names the score and shows its value
      And the reason is available on the score

    @integration
    Scenario: A score left on a key that was since deactivated still reads by name
      Given the turn carries an annotation scored on a key that is no longer active
      Then the card still names the score
      # Names resolve through every score key the project has ever had, not
      # only the active ones, so a card never degrades into a raw id.

    @integration
    Scenario: An annotation left through the API is labelled as such
      Given the turn carries an annotation with no LangWatch user behind it
      Then the card marks it as coming from the API
      And it shows the email it was left with, or "anonymous" when there is none

    @integration
    Scenario: A suggested correction is shown as a correction
      Given the turn carries an annotation with a suggested output
      Then the card shows the suggested output and marks it as a correction

  Rule: Saving from the rail refreshes what the conversation reads

    The conversation reads every turn's annotations through one batched feed.
    A save that leaves that feed cached hides the reviewer's own annotation
    from them until it expires minutes later.

    @integration
    Scenario: Saving from the rail refreshes the conversation's annotation feed
      Given the reviewer has written an annotation in the rail composer
      When they save it
      Then the batched annotation feed is refreshed
      And the composer closes
