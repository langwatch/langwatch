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
    Given the user is authenticated with "annotations:write" permission
    And the user opens a trace drawer on a conversation with 3 turns

  # ─── Action row visibility ──────────────────────────────────────────────

  Scenario: Action row renders on every turn
    Then each of the 3 turns shows an action row
    And the row contains "Annotate", "Suggest", and "Add to dataset" entries

  Scenario: Action row stays compact when the turn is collapsed
    Given a turn is collapsed
    Then its action row is not rendered until the turn is expanded

  Scenario: Action row is hidden for users without "annotations:write"
    Given the user only has "traces:view" permission
    Then no action row is rendered on any turn
    And the drawer-header "Add conversation to dataset" entry is also hidden

  # ─── Annotate ───────────────────────────────────────────────────────────

  Scenario: Annotate opens the annotation form scoped to that turn
    When the user clicks "Annotate" on the second turn
    Then an annotation form appears anchored to that turn
    And the form is pre-scoped to the second turn's traceId
    And the form's "comment" field has focus

  Scenario: Annotate from a turn that already has an annotation edits it
    Given the second turn's trace already has an annotation by the current user
    When the user clicks "Annotate" on the second turn
    Then the form opens in edit mode populated with the existing annotation

  Scenario: Submitting the annotation closes the form and shows the result
    Given the user has filled in the annotation form on the second turn
    When the user submits the form
    Then the form closes
    And the second turn shows an "annotated" badge
    And the annotation count on the trace summary increments by 1

  # ─── Annotation score keys ─────────────────────────────────────────────

  Scenario: Active score keys render as quick-rate buttons on each turn
    Given the project has 2 active annotation score keys: "Quality" (LIKERT 1-5) and "Tone" (OPTION friendly|neutral|harsh)
    Then each turn's action row shows a "Quality" key button and a "Tone" key button

  Scenario: Clicking a score key opens a small picker pre-filled for that key
    When the user clicks the "Quality" key on the first turn
    Then a picker shows the LIKERT 1-5 options for "Quality"
    And selecting "4" submits an annotation on the first turn with scoreOptions["Quality"].value = "4"

  Scenario: Score-key picker is dismissable without saving
    When the user clicks the "Quality" key, then presses Escape
    Then no annotation is created
    And the picker closes

  Scenario: No active score keys hides the inline buttons
    Given the project has zero active annotation score keys
    Then no key buttons render on any turn
    And the "Annotate" entry remains visible

  # ─── Suggest correction ────────────────────────────────────────────────

  Scenario: Suggest opens the annotation form focused on expected output
    When the user clicks "Suggest" on the third turn
    Then the annotation form opens scoped to that turn
    And the form's "expected output" field has focus
    And the field is pre-filled with the current output

  Scenario: Submitting a suggestion saves it as the annotation's expectedOutput
    Given the user has edited the expected-output field on the third turn
    When the user submits the form
    Then an annotation is created on the third turn's trace with the new expectedOutput
    And the third turn shows a "correction" badge

  # ─── Add to dataset (turn) ─────────────────────────────────────────────

  Scenario: Add to dataset on a turn opens the dataset drawer scoped to that turn
    When the user clicks "Add to dataset" on the first turn
    Then the AddDatasetRecordDrawer opens
    And it is pre-loaded with a single record built from the first turn's input and output

  Scenario: Saving the turn record adds one row to the chosen dataset
    Given the user picked dataset "regression-cases" in the drawer
    When the user saves
    Then exactly 1 record is added to "regression-cases"

  # ─── Add to dataset (whole conversation) ───────────────────────────────

  Scenario: Drawer header surfaces a conversation-level add-to-dataset entry
    Then the drawer header shows "Add conversation to dataset"

  Scenario: Whole-conversation add opens the dataset drawer with all turns
    When the user clicks "Add conversation to dataset"
    Then the AddDatasetRecordDrawer opens
    And it is pre-loaded with one record per turn in the conversation
    And each record carries that turn's input and output

  Scenario: Whole-conversation save adds N records for an N-turn conversation
    Given the conversation has 3 turns and the user picks dataset "qa-set"
    When the user saves
    Then exactly 3 records are added to "qa-set"

  # ─── Legacy parity ─────────────────────────────────────────────────────

  Scenario: The legacy TraceDetails annotate flow still works
    Given the user is on the legacy trace details page (not the v2 drawer)
    When the user clicks "Annotate"
    Then the legacy AnnotationComment flow opens unchanged
