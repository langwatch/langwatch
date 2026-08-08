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

  Scenario: Action row is hidden for users without "annotations:manage"
    Given the user only has "annotations:view" permission
    Then no `TurnActionRow` is rendered on any turn
    # The annotations:manage gate is checked by `TurnActionRow`; the
    # `Dataset` button is part of the same row and is hidden together.

  # ─── Annotate ───────────────────────────────────────────────────────────

  Scenario: Annotate opens the annotation popover anchored to the second turn
    When the user clicks "Annotate" on the second turn
    Then an `AnnotationPopover` opens in `mode="annotate"` anchored to that button
    And the form is pre-scoped to the second turn's traceId
    And the comment textarea is autofocused

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

  Scenario: Picking a value via a ScoreChip stages it on the popover form
    When the user opens a score chip and clicks an option
    Then `scoreOptions[scoreId].value` updates locally
    And on save the annotation is persisted with the staged scoreOptions

  Scenario: Score-chip popover dismisses without saving
    When the user opens a score chip, then presses Escape or clicks outside
    Then the chip popover closes
    And the staged value is preserved on the form (until the parent popover saves or cancels)

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

  @integration
  Scenario: The conversation offers no separate annotations mode
    Given the trace drawer is open on a conversation
    Then the conversation's mode segment offers thread, bubbles, and markdown only
    And every turn's annotations are read beside that turn in thread layout

  # ─── Legacy parity ─────────────────────────────────────────────────────

  Scenario: The legacy TraceDetails annotate flow still works
    Given the user is on the legacy trace details page (not the v2 drawer)
    When the user clicks "Annotate"
    Then the legacy AnnotationComment flow opens unchanged
