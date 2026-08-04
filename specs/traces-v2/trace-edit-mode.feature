# Trace edit mode: correcting a trace inside the drawer
#
# Implementation:
#   platform/app/src/features/traces-v2/stores/traceEditStore.ts                                (draft state)
#   platform/app/src/features/traces-v2/hooks/useTraceEditOverlay.ts                            (correction read + appliers)
#   platform/app/src/features/traces-v2/components/TraceDrawer/editMode/EditModeBar.tsx         (bar, save, discard)
#   platform/app/src/features/traces-v2/components/TraceDrawer/editMode/EditableIOField.tsx     (input/output editor)
#   platform/app/src/features/traces-v2/components/TraceDrawer/editMode/SpanNameTypeEditor.tsx  (name + type editor)
#   platform/app/src/features/traces-v2/components/TraceDrawer/editMode/EditedOriginalToggle.tsx (edited vs original)
#   platform/app/src/features/traces-v2/components/TraceDrawer/TraceEditDiffDialog.tsx          (unified diff)
#   platform/app/src/features/traces-v2/components/TraceDrawer/AttributeTable.tsx               (editable span params)
#
# Motivation: a reviewer curating production traces into an evaluation dataset
# needs to correct the trace where they are already reading it. Bouncing to a
# separate editor loses the context that told them what was wrong in the first
# place, and today the only correctable thing is the final expected output.
#
# Decisions:
#   - The correction is a draft until Save. Nothing is written while typing, so
#     leaving the drawer without saving leaves the trace exactly as captured.
#   - The draft is never serialized into the URL. Only the fact that the drawer
#     is in edit mode travels, as `drawer.edit=1`, so a teammate opening the
#     link lands in edit mode on the captured trace rather than on half of
#     somebody else's unsaved work.
#   - Editing needs permission to update annotations, matching the correction
#     write itself. The public share surface never offers it.
#   - Editing happens in the Trace and Summary views. The conversation,
#     terminal and usage views are read-only replays of an agent run, so
#     entering edit mode moves the reader to the Trace view and the other tabs
#     stay unavailable until they finish.
#   - A correction is displayed, not hidden: once one exists the reader can
#     switch between the corrected and the captured trace, sees which fields
#     changed, and can open a full diff.
#   - Editing does not fight privacy. A redacted or restricted field carries no
#     editor, because there is nothing on screen to correct.

Feature: Editing a trace in the drawer
  As a reviewer curating production traces
  I want to correct a trace where I am reading it and save the correction
  So that the dataset gets the corrected trace and everyone can still see what
  was originally captured

  Background:
    Given I am signed in to a project with permission to update annotations
    And I have a trace open in the trace drawer

  Rule: Entering edit mode is a deliberate, permitted action

    @integration
    Scenario: The overflow menu offers to edit the trace
      When I open the trace actions menu
      Then I see an action to edit the trace

    @integration
    Scenario: A reviewer without permission to update annotations cannot edit
      Given I do not have permission to update annotations
      When I open the trace actions menu
      Then I do not see an action to edit the trace

    @integration
    Scenario: A shared trace is never editable
      Given I am reading the trace on its public share page
      Then I do not see an action to edit the trace

    @unit
    Scenario: A deep link into edit mode starts the drawer editing
      Given a drawer link that asks for edit mode
      When the drawer hydrates from that link
      Then the trace opens with edit mode already started

    @unit
    Scenario: Edit mode is dropped from a link to a preview trace
      Given a drawer link that asks for edit mode on a sample preview trace
      When the drawer hydrates from that link
      Then the trace opens without edit mode

  Rule: While editing, the reader stays on a view that can be edited

    @planned
    Scenario: Entering edit mode from the conversation view moves to the trace view
      Given I am reading the conversation view
      When I start editing the trace
      Then the trace view is shown

    @planned
    Scenario: Views that cannot be edited are unavailable while editing
      Given I am editing the trace
      Then the conversation, usage and terminal tabs cannot be opened
      And each explains that I need to finish editing to switch views

  Rule: Saving is offered only once something has changed

    @integration
    Scenario: Save is unavailable until the reviewer changes something
      Given I am editing the trace
      Then I cannot save the correction
      When I rename a span
      Then I can save the correction

    @integration
    Scenario: The bar counts what the correction changes
      Given I am editing the trace
      When I rename a span and delete another span
      Then the bar reports one changed field and one deleted span

    @integration
    Scenario: Saving records the correction and leaves edit mode
      Given I am editing the trace
      And I have renamed a span
      When I save the correction
      Then the correction is stored with that rename
      And the drawer confirms the correction was saved
      And the drawer is no longer editing

    @integration
    Scenario: A failed save keeps the reviewer in edit mode with their work
      Given I am editing the trace
      And I have renamed a span
      When saving the correction fails
      Then the drawer reports that the correction could not be saved
      And I am still editing with my changes intact

  Rule: Unsaved work is never discarded silently

    @integration
    Scenario: Cancelling with unsaved changes asks first
      Given I am editing the trace
      And I have renamed a span
      When I cancel editing
      Then I am asked whether to discard my changes
      And choosing to keep editing leaves the changes in place

    @integration
    Scenario: Discarding drops the changes and leaves edit mode
      Given I am editing the trace
      And I have renamed a span
      When I cancel editing and confirm discarding
      Then the changes are gone
      And the drawer is no longer editing

    @unit
    Scenario: Cancelling without changes leaves edit mode straight away
      Given I am editing the trace
      When I cancel editing
      Then the drawer is no longer editing

    @planned
    Scenario: Closing the drawer with unsaved changes asks first
      Given I am editing the trace
      And I have renamed a span
      When I close the drawer
      Then I am asked whether to discard my changes

    @planned
    Scenario: Navigating to another trace with unsaved changes asks first
      Given I am editing the trace
      And I have renamed a span
      When I open a different trace
      Then I am asked whether to discard my changes

  Rule: Editing a field is a plain text edit that keeps its shape

    @integration
    Scenario: A captured JSON value opens as readable JSON
      Given I am editing a span whose output is a JSON object
      When I open the output editor
      Then the editor shows the value formatted across lines

    @integration
    Scenario: Text that is not valid JSON is accepted with a warning
      Given I am editing a span whose output is a JSON object
      When I replace the output with text that is not valid JSON
      Then I am warned that the value will be saved as plain text
      And I can still save the correction

    @integration
    Scenario: Resetting a field returns the captured value
      Given I am editing a span whose output is a JSON object
      And I have replaced the output
      When I reset the output
      Then the editor shows the captured value again
      And the correction no longer changes the output

    @integration
    Scenario: A value too large to edit inline says so
      Given I am editing a span whose output is larger than the drawer renders
      Then the output cannot be edited here
      And the reason is explained

    @planned
    Scenario: A redacted field carries no editor
      Given I am editing a span whose input is hidden from me
      Then the input cannot be edited

  Rule: Attributes are editable as key and value pairs

    @integration
    Scenario: Changing an attribute value records it in the correction
      Given I am editing a span with attributes
      When I change an attribute value
      Then the correction carries the new value

    @integration
    Scenario: Removing an attribute strikes it through and can be undone
      Given I am editing a span with attributes
      When I remove an attribute
      Then the attribute reads as removed
      And I can restore it

    @integration
    Scenario: Adding an attribute rejects a key that already exists
      Given I am editing a span with attributes
      When I add an attribute using a key that already exists
      Then I am told the key already exists
      And the attribute is not added

    @integration
    Scenario: An attribute hidden from me carries no editor
      Given I am editing a span with an attribute I am not allowed to read
      Then that attribute cannot be edited

  Rule: Deleting a span is a draft decision, reversible until saved

    @unit
    Scenario: Deleting a span marks it and its descendants
      Given I am editing a trace whose spans form a tree
      When I delete a parent span
      Then the parent reads as deleted

    @unit
    Scenario: Restoring a deleted span brings it back
      Given I am editing the trace
      And I have deleted a span
      When I restore that span
      Then the correction no longer deletes it

    @planned
    Scenario: Deleting the selected span closes its detail pane
      Given I am editing the trace
      And a span is selected
      When I delete that span
      Then no span is selected

  Rule: A corrected trace shows what changed and what was captured

    @integration
    Scenario: The corrected trace is what the reader sees by default
      Given the trace has a correction that renames a span
      When I open the trace
      Then the span reads with its corrected name
      And I can switch to the captured trace

    @integration
    Scenario: Switching to the captured trace shows the original values
      Given the trace has a correction that renames a span
      When I switch to the captured trace
      Then the span reads with its captured name

    @integration
    Scenario: The correction names who made it
      Given the trace has a correction made by a teammate
      When I open the trace
      Then I see that the trace was edited by that teammate

    @integration
    Scenario: A trace with no correction offers no switch
      Given the trace has no correction
      When I open the trace
      Then there is nothing to switch between

    @unit
    Scenario: A deleted span is hidden in the corrected trace
      Given the trace has a correction that deletes a span
      When I read the corrected trace
      Then that span is not listed

    @integration
    Scenario: A deleted span is marked in the captured trace
      Given the trace has a correction that deletes a span
      When I switch to the captured trace
      Then that span is listed and marked as deleted

    @integration
    Scenario: A corrected field is highlighted and reveals its captured value
      Given the trace has a correction that changes a span output
      Then the corrected output is highlighted as edited
      When I hover the edited marker
      Then the captured output is shown

    @integration
    Scenario: A captured value too long to read in a hover links to the diff
      Given the trace has a correction that changes a very long span output
      When I hover the edited marker
      Then the captured output is shortened
      And I am offered the full difference instead

    @integration
    Scenario: A corrected attribute is highlighted and names its captured value
      Given the trace has a correction that changes a span attribute
      Then that attribute is highlighted as edited
      And it names the captured value

    @integration
    Scenario: An attribute the correction added is marked as added
      Given the trace has a correction that adds a span attribute
      Then that attribute is marked as added by an edit

    @integration
    Scenario: A corrected span name names its captured name
      Given the trace has a correction that renames a span
      When I open that span
      Then the corrected name is highlighted as edited
      And it names the captured name

  Rule: The full difference is one click away

    @integration
    Scenario: The diff lists the lines the correction added and removed
      Given the trace has a correction that renames a span
      When I open the difference view
      Then I see the captured line removed and the corrected line added

    @integration
    Scenario: The diff says so when nothing differs
      Given the trace has a correction that changes nothing about the trace
      When I open the difference view
      Then it reports no changes
