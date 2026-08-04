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
#   - A correction never overrides privacy. A correction quotes the trace it
#     corrects, so it is cut down to what the reader may see BEFORE it is
#     handed out or applied: content categories they cannot read, content teased
#     by the plan's visibility window, and attributes a restrict rule hides all
#     drop out of the patch itself. Structural edits always survive, because
#     they say what the trace should have looked like without quoting any of it.
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

    @unit
    Scenario: Two reviewers saving the first correction at once both succeed
      Given a trace with no correction
      When two reviewers save the first correction at the same moment
      Then the reviewer who lost the race stores their correction as an update
      And neither reviewer sees an error

  Rule: A correction is read through the same privacy gates as the trace

    @integration
    Scenario: A viewer who may not read captured content is handed only the structural edits
      Given a correction that edits a span input, a span output and the trace output, and renames a span
      And a privacy policy that hides captured input and output from me
      When I read the correction for that trace
      Then the correction I receive carries no corrected content
      And the rename and the deletions are still there
      And a viewer the policy allows receives the whole correction

    @unit
    Scenario: A viewer who may not read captured content sees the original
      Given a correction that edits a span input and the trace output
      And a viewer whose privacy policy hides captured input and output
      When that viewer reads the trace
      Then the captured input and output are unchanged
      And structural edits such as renames and deletions still apply

    @unit
    Scenario: A restricted attribute stays hidden inside a corrected attribute set
      Given a correction that rewrites a span's attributes
      And an attribute rule that hides one of them from me
      When I read the trace with corrections
      Then that attribute reads as restricted rather than as the corrected value
      And the other corrected attributes are there

    @unit
    Scenario: Corrected content is withheld beyond the plan's visibility window
      Given a trace whose content is teased because it predates the plan window
      When its correction is read
      Then no corrected content comes back
      And the structural edits still do

    @integration
    Scenario: A reviewer who cannot read a field cannot remove its correction
      Given a correction whose span output and trace output were written by someone else
      And a privacy policy that hides captured output from me
      When I save a correction that only renames a span
      Then the rename is stored
      And the corrected outputs I never saw are still stored
      And removing the whole correction stays a separate, deliberate action

    @unit
    Scenario: A saved correction keeps the edits the saver was never shown
      Given a stored correction holding content edits and a restricted attribute
      When a reviewer who may not read them saves their own edits over it
      Then their edits are kept
      And the withheld edits come back exactly as they were stored
      And a span whose only edits were withheld is not dropped

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

    @unit
    Scenario: A dataset output column carries the corrected output
      Given a trace whose output was corrected, whether in the drawer or through a suggestion
      When the trace is mapped into a dataset row
      Then the output column holds the corrected output, not the captured one
      And the trace id column still identifies the captured trace

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
    Scenario: Clearing the suggestion takes the corrected output back off
      Given a trace whose correction renames a span and carries a suggested output
      When I clear the suggestion on that annotation
      Then the trace output correction is gone
      And the span rename is still there

    @integration
    Scenario: Clearing the only suggestion returns the trace to uncorrected
      Given a trace corrected only through a suggested output
      When I clear the suggestion on that annotation
      Then the trace reads as uncorrected

    @integration
    Scenario: Re-saving a comment does not re-assert the suggestion it opened with
      Given a trace whose correction was updated after the annotation was written
      When I save that annotation again with only its comment changed
      Then the correction is left exactly as it was

    @integration
    Scenario: Saving a comment with an empty suggestion never removes a correction
      Given a trace with a correction and a comment form that carries no suggestion text
      When I save the comment
      Then the correction is still there

    @integration
    Scenario: An annotator who may only create annotations does not move the correction
      Given I may create annotations but not update them
      When I save an annotation carrying a suggested output
      Then the annotation is saved
      And the trace correction is left alone

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

    @integration
    Scenario: Marking a teammate's queue item is refused
      Given a queue item assigned to a teammate, on a queue I do not belong to
      When I mark it for the dataset
      Then the request is refused
      And the queue item carries no mark

    @integration
    Scenario: Clearing marks leaves a teammate's marks alone
      Given a marked item of mine and a marked item of a teammate's
      When I clear the marks for both
      Then only mine is cleared
