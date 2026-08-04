# Trace edit overlay — corrections stored beside an immutable trace
#
# Implementation:
#   platform/app/src/server/traces/edit-overlay/traceEditOverlay.schemas.ts    (patch contract, version 1)
#   platform/app/src/server/traces/edit-overlay/applyTraceEditOverlay.ts       (pure appliers)
#   platform/app/src/server/traces/edit-overlay/traceEditOverlay.repository.ts (one row per project + trace)
#   platform/app/src/server/traces/edit-overlay/traceEditOverlay.service.ts    (read, upsert, merge, delete)
#   platform/app/src/server/api/routers/traceEditOverlay.ts                    (tRPC surface)
#   platform/app/src/server/traces/trace.service.ts                            (withEditOverlay read seam)
#   platform/app/src/server/api/routers/annotation.ts                          (suggestion dual-write, queue marks)
#
# Motivation: the curation loop is production traces, then correction, then an
# evaluation dataset. Today the only correctable thing is the final expected
# output, so a trace that contains an unnecessary tool call reaches the dataset
# with that noise still in it. Reviewers need to correct any part of a trace
# (span names, inputs, outputs, attributes, whole spans) and have the dataset
# read exactly what they corrected, without ever rewriting what was ingested.
#
# Decisions:
#   - Corrections live in Postgres as one row per (project, trace), not in
#     ClickHouse. The captured trace stays immutable and the correction is
#     applied at read time.
#   - The patch is shaped like the canonical trace model, replaces whole fields
#     rather than describing character diffs, and names deleted spans
#     explicitly. Descendants of a deleted span are dropped when the patch is
#     applied, not when it is written, so the stored patch stays small and
#     stable while spans are still arriving.
#   - Reads opt in. Only the add-to-dataset path asks for the corrected trace.
#     Evaluations, exports, public shares and the REST API keep reading the
#     original.
#   - Reading a correction needs permission to view traces; writing one needs
#     permission to update annotations, because correcting a trace is review
#     work and external reviewers hold annotation permissions, not trace ones.
#   - A correction never overrides privacy. A viewer who may not read captured
#     input or output sees the original placeholder, not the corrected content.
#   - The existing "suggest an expected output" flow keeps writing its
#     annotation and additionally merges an output-only correction, so the
#     annotation stays the record of who suggested what and the overlay stays
#     the current corrected truth.
#   - No new error codes. Absence of a correction is the normal state and reads
#     as nothing; a malformed patch is a validation rejection on write and
#     degrades to nothing on read.

Feature: Correcting a trace without rewriting it
  As a reviewer curating production traces into an evaluation dataset
  I want to correct anything in a trace and save the correction beside it
  So that the dataset gets the corrected trace while the captured trace stays
  exactly as it was ingested

  Background:
    Given I am signed in to a project with permission to update annotations

  Rule: A trace has at most one correction, authored and replaceable

    @integration
    Scenario: Saving a correction stores it with its author
      Given a trace with no correction
      When I save a correction that renames a span
      Then the trace has a correction holding that rename
      And the correction records me as its author

    @integration
    Scenario: Saving again replaces the correction and records the last editor
      Given a trace already corrected by another reviewer
      When I save a different correction for the same trace
      Then the trace still has exactly one correction
      And the correction holds only my edits
      And the correction records the original author and me as the last editor

    @integration
    Scenario: A trace with no correction reads as uncorrected
      Given a trace that nobody has corrected
      When I read the correction for that trace
      Then no correction is returned

    @integration
    Scenario: A correction that changes nothing is rejected
      Given a trace with no correction
      When I save a correction that names no edit at all
      Then the save is rejected as invalid
      And the trace still has no correction

    @integration
    Scenario: A correction that is not shaped like a trace is rejected
      When I save a correction whose span input is not a captured value
      Then the save is rejected as invalid
      And the trace still has no correction

    @integration
    Scenario: Removing a correction is idempotent and restores the original
      Given a trace with a saved correction
      When I remove the correction
      Then the trace reads as uncorrected
      And removing it again succeeds without error

    @integration
    Scenario: A stored correction that can no longer be understood reads as none
      Given a correction row whose stored patch does not match the contract
      When I read the correction for that trace
      Then no correction is returned
      And the read does not fail

    @integration
    Scenario: Saving a correction without permission to update annotations is refused
      Given I may view the project but not update its annotations
      When I save a correction for a trace
      Then the save is refused
      And the trace still has no correction

  Rule: Corrections are applied over the original at read time

    @unit
    Scenario: An edited span field replaces the whole field
      Given a trace whose span carries a captured output
      When a correction sets a new output on that span
      Then the read trace carries the corrected output
      And the captured span timings and metrics are untouched

    @unit
    Scenario: Deleting a span drops its descendants too
      Given a trace where a tool span has a child span
      When a correction deletes the tool span
      Then neither the tool span nor its child is in the read trace
      And unrelated sibling spans are still there

    @unit
    Scenario: A trace output correction replaces the trace output
      Given a trace with a captured output
      When a correction sets a new trace output
      Then the read trace carries the corrected trace output

    @unit
    Scenario: Clearing a span error removes the error
      Given a trace whose span captured an error
      When a correction clears that span error
      Then the read span carries no error

    @unit
    Scenario: Deleted span ids that are not in the trace are ignored
      Given a correction naming a span id that this trace does not contain
      When the trace is read
      Then every captured span is still returned

    @unit
    Scenario: A viewer who may not read captured content sees the original
      Given a correction that edits a span input and the trace output
      And a viewer whose privacy policy hides captured input and output
      When that viewer reads the trace
      Then the captured input and output are unchanged
      And structural edits such as renames and deletions still apply

    @unit
    Scenario: A correction with nothing to apply returns the trace untouched
      Given a correction whose edits name no span in this trace
      When the trace is read
      Then the very same trace is returned

    @unit
    Scenario: Text edited back into a chat transcript is stored as chat messages
      When a reviewer edits a chat transcript field and saves valid transcript text
      Then the correction stores it as a chat transcript, not as plain text
      And text that is not valid JSON is stored as plain text

    @unit
    Scenario: A corrected span still fits the dataset span shape
      Given a correction that renames a span and rewrites its input and output
      When the corrected spans are mapped for a dataset
      Then every mapped span satisfies the dataset span shape

  Rule: Only the dataset path reads the corrected trace

    @unit
    Scenario: The add-to-dataset read returns the corrected trace
      Given a trace with a saved correction
      When the add-to-dataset drawer reads the trace
      Then the corrected spans are returned

    @unit
    Scenario: Readers that do not ask for corrections get the original
      Given a trace with a saved correction
      When any other consumer reads the trace
      Then the captured spans are returned unchanged
      And no correction is fetched at all

    @unit
    Scenario: A page of traces fetches its corrections in one read
      Given several corrected traces read together
      When the corrected traces are requested
      Then the corrections are fetched once for the whole page

    @unit
    Scenario: Thread mode applies each trace its own correction
      Given two traces in one conversation, each with a different correction
      When the conversation is read with corrections
      Then each trace carries only its own correction

    @unit
    Scenario: Corrections are applied after the trace content is fully resolved
      Given a corrected trace whose captured content is resolved from storage
      When the trace is read with corrections
      Then the correction wins over the resolved captured content

  Rule: A suggested expected output is recorded as a correction

    @integration
    Scenario: Suggesting an output writes the annotation and the correction
      Given a trace with no correction
      When I save an annotation carrying a suggested output
      Then the annotation records my suggestion
      And the trace has a correction whose trace output is that suggestion

    @integration
    Scenario: Updating a suggestion keeps the other corrections on the trace
      Given a trace whose correction renames a span and sets a trace output
      When I update the suggestion with new text
      Then the trace output correction is the new text
      And the span rename is still there

    @unit
    Scenario: Merging a suggested output preserves the rest of the correction
      Given a stored correction that deletes a span and renames another
      When an output-only correction is merged into it
      Then the deletion and the rename survive the merge

    @integration
    Scenario: An annotation without a suggestion never touches the correction
      Given a trace with no correction
      When I save an annotation with a comment and no suggested output
      Then the trace still has no correction

    @integration
    Scenario: Deleting the suggestion annotation leaves the correction in place
      Given a trace corrected through a suggested output
      When I delete the annotation that carried the suggestion
      Then the correction is still there
      And removing the correction is a separate, explicit action

  Rule: Queue items carry the mark for the end-of-queue dataset hand-off

    @integration
    Scenario: Marking a queue item for the dataset persists the mark
      Given an annotation queue item I have not marked
      When I mark it to be added to a dataset at the end
      Then the mark is persisted on the queue item
      And it is still marked when the queue is read again

    @integration
    Scenario: Unmarking a queue item clears the mark
      Given an annotation queue item I marked for the dataset
      When I unmark it
      Then the queue item carries no mark

    @integration
    Scenario: Marks are cleared for a batch of queue items at once
      Given several marked queue items
      When the marks are cleared for those items
      Then none of them carries a mark
      And queue items outside the batch keep their marks

    @integration
    Scenario: Marking a queue item needs permission to update annotations
      Given I may view the project but not update its annotations
      When I mark a queue item for the dataset
      Then the request is refused
      And the queue item carries no mark
