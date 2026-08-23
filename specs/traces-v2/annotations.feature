# Per-message annotate, suggest and translate actions
# Covers: the message action cluster, the separator's edit-trace action,
# annotation score keys, suggest correction
#
# Each message in the trace drawer's ConversationView carries its own boxed
# action cluster so reviewers can translate, comment on, or correct exactly
# the side of the turn they are reading. Every action names its target: a
# comment or suggestion is about the turn's input or its output, never about
# an unnamed whole. The turn separator keeps one action of its own, opening
# the turn's trace in the editor. The whole-conversation actions live in the
# drawer header and operate on the full thread.

Feature: Per-message actions in ConversationView
  Reviewers act on individual messages, translating, annotating and
  suggesting corrections, without leaving the conversation flow.

  Background:
    Given the user is authenticated with "annotations:manage" permission
    And the user opens a trace drawer on a conversation with 3 turns

  # ─── Message action cluster ─────────────────────────────────────────────

  @integration
  Scenario: Each message offers Translate, Annotate and Suggest on hover
    Then the user message and the reply of a turn each reveal a boxed action
    cluster on hover
    And the cluster reads "Translate", "Annotate", "Suggest" in that order

  @integration
  Scenario: Each action asks for the permission its own work needs
    Given the user only has "annotations:view" permission
    Then no message offers a way to annotate or suggest
    And translating each message is still offered to every reader

  @integration
  Scenario: The turn separator offers to edit the turn's trace
    When the user hovers a turn separator
    Then it reveals a single "Edit trace" action
    And choosing it opens that turn's trace in the drawer, in annotation mode
    And the drawer does not open on the conversation tab

  # The drawer moves before the address does. Asking the address to move a
  # drawer that is already on screen leaves the drawer's two address keepers
  # correcting each other, one granting the request and one undoing it, and
  # the page locks up rewriting itself.
  @integration
  Scenario: Edit trace works while the drawer is already open on the conversation
    Given the trace drawer is already open on another trace's conversation
    When the user chooses "Edit trace" on a turn separator
    Then the drawer is on that turn's trace, in annotation mode
    And it settles there at once

  # ─── Annotate ───────────────────────────────────────────────────────────

  @integration
  Scenario: Annotate opens the composer in the rail beside the turn
    When the user clicks "Annotate" on the second turn's reply
    Then the composer opens in that turn's rail
    And the form is anchored to the second turn's output

  @integration
  Scenario: In bubbles layout, existing annotations are edited via the badge popover
    Given the conversation is in bubbles layout
    And the second turn's trace already has an annotation
    When the user clicks the `TurnAnnotationBadges` count chip on the second turn
    Then a popover lists existing annotations
    When the user picks an annotation row
    Then the correction popover opens on that annotation for editing
    And it is anchored on the row itself, so closing it hands the keyboard back
    And each row is a button, so a reviewer working from the keyboard picks it the
    same way
    And a reviewer who may not write annotations is offered no such control
    # Thread layout edits from the rail instead, in the card's own place.
    # See specs/traces-v2/annotation-rail.feature.

  Scenario: Submitting the annotation closes the popover and refreshes the count
    Given the user has filled in the annotation popover on the second turn
    When the user submits the form
    Then the popover closes
    And `api.annotation.getByTraceId` is invalidated so the count chip re-renders
    And a success toast "Annotation saved" appears

  # The conversation reads every turn's annotations through one batched feed
  # rather than a query per turn. That feed is the source for the counts, the
  # badge lists and the rail, so a write that leaves it cached hides the
  # reviewer's own annotation from them until the cache expires minutes later.
  @integration
  Scenario: Saving, updating, or deleting an annotation refreshes the batched annotation feed
    Given the conversation reads its turns' annotations through the batched feed
    When the reviewer saves, updates, or deletes an annotation on a turn
    Then the batched feed is invalidated alongside the per-trace annotation read
    And the turn's count and annotation list reflect the write immediately

  # ─── Annotation score keys ─────────────────────────────────────────────

  Scenario: Score keys render as `ScoreChip`s inside the annotation popover
    Given the project has active annotation score keys
    When the annotation popover is open
    Then a "Scores" section renders one `ScoreChip` per active key (LIKERT, OPTION, CHECKBOX)

  # A score chip opens a small form, not a menu. The rating and the reason
  # behind it are given together and land together, so a reviewer who wants to
  # say why is never sent back into a chip that closed itself the moment they
  # picked. Nothing the reviewer does inside the chip counts until they confirm,
  # which is what makes closing it any other way a way out.
  @integration
  Scenario: Picking a rating keeps the editor open until it is confirmed
    Given the reviewer opened a score chip
    When they pick one of its options
    Then the editor stays open with that option selected
    And the chip reads as unrated until they confirm

  @integration
  Scenario: Confirming keeps the rating and the reason given with it
    Given the reviewer opened a score chip and picked an option
    When they type a reason and confirm
    Then the editor closes
    And the chip reads with that rating on it and says it carries a reason
    And saving the annotation persists the rating and the reason together

  @integration
  Scenario: Leaving the editor any other way keeps the rating it had
    When the reviewer picks an option, then presses Escape or clicks outside
    Then the editor closes
    And the score keeps whatever rating it had before the editor opened

  @integration
  Scenario: Clearing a score returns it to unrated
    Given a score the reviewer already rated, with a reason
    When they open its chip and clear it
    Then the editor closes
    And the chip reads as unrated, carrying neither rating nor reason

  @integration
  Scenario: A multiple-choice score takes several options at once
    Given a score key whose options are multiple-choice
    When the reviewer ticks two of them and confirms
    Then the chip reads as carrying both

  Scenario: No active score keys hides the Scores section
    Given the project has zero active annotation score keys
    Then the "Scores" section is omitted from the popover body
    And the "Annotate" trigger remains visible

  # ─── Suggest correction ────────────────────────────────────────────────

  Scenario: Suggest opens the composer with the expected-output field focused
    When the user clicks "Suggest" on the third turn's reply
    Then the suggest composer opens in that turn's rail, anchored to its output
    And the expected-output textarea is autofocused
    And the field is pre-filled with the turn's current output

  @integration
  Scenario: Suggest on the user message pre-fills the message text
    When the user clicks "Suggest" on the second turn's user message
    Then the suggest composer opens anchored to that turn's input
    And the field is pre-filled with the user message's text
    And the diff reads against that text, not against the reply

  Scenario: Suggest renders an inline word-level diff against the original text
    When the user edits the expected-output textarea
    Then the diff panel below shows additions / removals via `diffWordsWithSpace`
    And a +N / −N counts row updates as the user types

  Scenario: Submitting a suggestion saves it as the annotation's expectedOutput
    Given the user has edited the expected-output field on the third turn's reply
    When the user submits the form
    Then an annotation is created on the third turn's trace with the new expectedOutput
    And the reply's annotation chip renders a yellow Lightbulb "correction" indicator

  # ─── A suggestion is also the trace's correction ───────────────────────
  #
  # Suggesting is the reviewer-facing half of a trace correction. The
  # annotation stays the record of who suggested what, and the same text is
  # also stored as the trace's corrected output, so the add-to-dataset read
  # returns the corrected trace. That second write happens inside the two
  # annotation mutations this popover saves through, so every surface that
  # suggests gets it: the per-turn action row here, the rail composer in thread
  # layout, and the saved-suggestion list under an output. The storage half is
  # specified in
  # specs/traces-v2/trace-edit-overlay.feature.

  # Reading corrections back where the output is shown, as a plain list rather
  # than an editor. The v2 conversation shows them beside the turn instead
  # (specs/traces-v2/annotation-rail.feature).

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

  @integration
  Scenario: Saving an edit before the annotation is read writes nothing
    Given I open an annotation for editing
    And the annotation has not been read back yet
    When I save
    Then nothing is written, so the turn does not end up carrying it twice
    And the save control says it is not ready

  # ─── Add to dataset (whole conversation) ───────────────────────────────
  #
  # A single turn no longer has a one-click dataset action in the
  # conversation: capturing one turn goes through "Edit trace" to that turn
  # and the drawer header's add-to-dataset, and the annotation queue's session
  # flow captures turns in bulk (specs/annotations/annotation-queue-workflow.feature).

  Scenario: Drawer header surfaces a conversation-level add-to-dataset entry
    # Lives in TraceOverflowMenu, shown when the trace belongs to a
    # conversation, with the turn count beside it.
    Then the drawer header shows "Add conversation to dataset"

  Scenario: Whole-conversation add opens the dataset drawer with all turns
    When the user clicks "Add conversation to dataset"
    Then the AddDatasetRecordDrawer opens preloaded with one record per turn

  @planned
  Scenario: Whole-conversation save adds N records for an N-turn conversation
    Given the conversation has 3 turns and the user picks dataset "qa-set"
    When the user saves
    Then exactly 3 records are added to "qa-set"

  # ─── Conversation-level annotations ────────────────────────────────────
  #
  # Annotations read beside the turn they are about, not in a rollup the
  # reviewer has to leave the conversation to open. The rail is specified in
  # specs/traces-v2/annotation-rail.feature.
  #
  # Annotation mode does not change this. It is a state the whole drawer enters,
  # laid over whichever view the reviewer is already reading, and it adds
  # affordances to what is on screen rather than a place to go and look at
  # annotations. So there is still no annotations view: thread, bubbles and
  # markdown remain the whole of the conversation's mode segment, in the mode
  # and out of it. The mode itself is specified in
  # specs/traces-v2/trace-edit-mode.feature, and what a comment can be left on
  # in specs/traces-v2/anchored-comments.feature.

  @integration
  Scenario: The conversation offers no separate annotations mode
    Given the trace drawer is open on a conversation
    Then the conversation's mode segment offers thread, bubbles, and markdown only
    And every turn's annotations are read beside that turn in thread layout

  @integration @unimplemented
  Scenario: Annotating the trace adds no fourth way to view the conversation
    Given the trace drawer is open on a conversation
    When the reviewer starts annotating the trace
    Then the conversation's mode segment still offers thread, bubbles, and markdown only
    And the layout the reviewer was reading is the one they are still reading

  # ─── Legacy parity ─────────────────────────────────────────────────────

  Scenario: The legacy TraceDetails annotate flow still works
    Given the user is on the legacy trace details page (not the v2 drawer)
    When the user clicks "Annotate"
    Then the legacy AnnotationComment flow opens unchanged
