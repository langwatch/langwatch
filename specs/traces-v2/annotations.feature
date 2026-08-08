# Per-turn annotate, suggest, and add-to-dataset actions
# Covers: turn action row, annotation score keys, suggest correction, add-to-dataset (turn + conversation)
#
# Each turn in the trace drawer's ConversationView gets its own action row so
# reviewers can rate, correct, or capture a single turn without scrolling away
# from the conversation. The whole-conversation actions live in the drawer
# header and operate on the full thread.

Feature: Per-turn actions in ConversationView
  Reviewers act on individual turns — annotating, suggesting corrections,
  and capturing turns into datasets — without leaving the conversation flow.

  Background:
    Given the user is authenticated with "annotations:manage" permission
    And the user opens a trace drawer on a conversation with 3 turns

  # ─── Action row visibility ──────────────────────────────────────────────

  Scenario: Action row renders on every turn separator
    Then each of the 3 turn separators renders a `TurnActionRow`
    And the row contains "Annotate", "Suggest", and "Dataset" buttons

  @planned
  Scenario: Action row collapses with a collapsed turn
    # Not yet implemented as of 2026-05-01 — turns in ConversationView are
    # not collapsible; every turn always renders its action row.
    Given a turn is collapsed
    Then its action row is not rendered until the turn is expanded

  @integration
  Scenario: Each action asks for the permission its own work needs
    Given the user only has "annotations:view" permission
    Then the turn offers no way to annotate or suggest
    And the turn still offers to be captured into a dataset
    And translating the turn is offered to every reader
    # Capturing a turn into a dataset is dataset work and is offered wherever
    # add-to-dataset is offered, rather than behind the annotation permission
    # it happens to sit beside.

  # ─── Annotate ───────────────────────────────────────────────────────────

  @integration
  Scenario: Annotate opens the composer in the rail beside the turn
    When the user clicks "Annotate" on the second turn
    Then the composer opens in that turn's rail
    And the form is pre-scoped to the second turn's traceId

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

  @planned
  Scenario: Inline score-key quick buttons on the turn action row
    # Not yet implemented as of 2026-05-01 — score keys live inside the
    # AnnotationPopover, not as inline buttons on the turn action row.
    Given the project has 2 active annotation score keys
    Then each turn's action row shows one button per key

  # ─── Suggest correction ────────────────────────────────────────────────

  Scenario: Suggest opens AnnotationPopover with the expected-output field focused
    When the user clicks "Suggest" on the third turn
    Then the annotation popover opens in `mode="suggest"` scoped to that turn
    And the expected-output textarea is autofocused
    And the field is pre-filled with the turn's current output

  Scenario: Suggest renders an inline word-level diff against the original output
    When the user edits the expected-output textarea
    Then the diff panel below shows additions / removals via `diffWordsWithSpace`
    And a +N / −N counts row updates as the user types

  Scenario: Submitting a suggestion saves it as the annotation's expectedOutput
    Given the user has edited the expected-output field on the third turn
    When the user submits the form
    Then an annotation is created on the third turn's trace with the new expectedOutput
    And the turn's `TurnAnnotationBadges` chip renders a yellow Lightbulb "correction" indicator

  # ─── A suggestion is also the trace's correction ───────────────────────
  #
  # Suggesting is the reviewer-facing half of a trace correction. The
  # annotation stays the record of who suggested what, and the same text is
  # also stored as the trace's corrected output, so the add-to-dataset read
  # returns the corrected trace. That second write happens inside the two
  # annotation mutations this popover saves through, so every surface that
  # suggests gets it: the per-turn action row here, the rail composer in thread
  # layout, the legacy trace details page, and the saved-suggestion list under
  # a message. The storage half is specified in
  # specs/traces-v2/trace-edit-overlay.feature.

  @integration
  Scenario: The legacy conversation suggests through the same correction popover
    Given the reviewer is reading a message in the legacy conversation on the trace details page
    When the reviewer uses the suggest action on it
    Then the same correction popover opens in suggest mode for that message's trace
    And it is pre-filled with the message's current output, so the reviewer edits in place

  # The saved-suggestion list under a message is the legacy conversation's own
  # way of reading corrections back. The v2 conversation shows them beside the
  # turn instead (specs/traces-v2/annotation-rail.feature).

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

  # ─── Add to dataset (turn) ─────────────────────────────────────────────

  Scenario: "Dataset" on a turn opens the AddDatasetRecord drawer scoped to that turn
    When the user clicks "Dataset" on the first turn
    Then `openDrawer("addDatasetRecord", { traceId })` is called for the first turn
    And the dataset drawer is preloaded for that single trace

  @planned
  Scenario: Saving the turn record adds one row to the chosen dataset
    # The post-save invariant is implemented inside AddDatasetRecordDrawerV2,
    # not in traces-v2. Marked planned here because the spec describes the
    # full end-to-end record-count behaviour, which this surface only
    # delegates to.
    Given the user picked dataset "regression-cases" in the drawer
    When the user saves
    Then exactly 1 record is added to "regression-cases"

  # ─── Add to dataset (whole conversation) ───────────────────────────────

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
