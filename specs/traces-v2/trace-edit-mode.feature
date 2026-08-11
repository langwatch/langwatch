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
#   platform/app/src/features/traces-v2/components/TraceDrawer/editMode/TraceEditableInput.tsx  (trace input editor)
#   platform/app/src/features/traces-v2/components/TraceDrawer/editMode/useTraceMetadataEditing.ts (trace metadata editor)
#   platform/app/src/server/traces/edit-overlay/traceMetadataEditableKeys.ts                    (which metadata keys are editable)
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
#   - The mode is reachable from the Trace, Summary and Conversation views. The
#     terminal and usage views are read-only replays of an agent run, so
#     entering the mode from one of them moves the reader to the Trace view and
#     those tabs stay unavailable until they finish. The conversation stays
#     reachable, because it is where commenting on a turn reads best.
#   - The URL says `drawer.edit=1` and keeps saying it. The mode's name is what
#     the reviewer reads, not what a link carries, and changing the parameter
#     would break every link already shared.
#   - The mode is one mode, and it is named after the whole job: annotating a
#     trace covers correcting it and commenting on it in the same pass, the way
#     a document review holds suggestions and comments at once. A reviewer does
#     not have to decide which of the two they are about to do before starting.
#   - Corrections and comments are saved on different clocks, on purpose. A
#     correction is a draft until Save, because it is one patch over the whole
#     trace and it only makes sense as a whole. A comment is its own record and
#     is saved as it is written, because it is somebody's remark and nothing
#     later in the pass can invalidate it. That means Save and the discard
#     prompt speak about the corrections only, and both have to say so plainly:
#     a reviewer who reads "discard your changes" after leaving eight comments
#     has to be certain the comments are not what is at risk.
#   - A correction is displayed, not hidden: once one exists the reader can
#     switch between the corrected and the captured trace, sees which fields
#     changed, and can open a full diff.
#   - Editing does not fight privacy. A redacted or restricted field carries no
#     editor, because there is nothing on screen to correct.
#   - The trace's own input is corrected beside its output. A dataset row is
#     built from both, so a reviewer fixing a mislabelled question had to leave
#     the drawer for the dataset editor to do it.
#   - Trace metadata is corrected in place, except for the keys that decide
#     where the trace belongs: the platform's own `langwatch.` namespace, and
#     the grouping keys a conversation, a user, a customer or a scenario run is
#     assembled from. Correcting those would re-parent the trace, which a
#     correction read on top of the captured trace cannot honor.
#   - A correction carries only what the reviewer actually changed. Touching a
#     field and putting it back leaves nothing behind, and a field the reviewer
#     never touched is never written, so nothing reads as edited that is not.

Feature: Editing a trace in the drawer
  As a reviewer curating production traces
  I want to correct a trace where I am reading it and save the correction
  So that the dataset gets the corrected trace and everyone can still see what
  was originally captured

  Background:
    Given I am signed in to a project with permission to update annotations
    And I have a trace open in the trace drawer

  Rule: Entering annotation mode is a deliberate, permitted action

    @integration
    Scenario: A reviewer without permission to update annotations cannot annotate
      Given I do not have permission to update annotations
      When I open the trace actions menu
      Then I do not see an action to annotate the trace

    @integration
    Scenario: A shared trace is never editable
      Given I am reading the trace on its public share page
      Then I do not see an action to annotate the trace

    @unit
    Scenario: A deep link into annotation mode starts the drawer in it
      Given a drawer link that asks for annotation mode
      When the drawer hydrates from that link
      Then the trace opens with annotation mode already started

    @unit
    Scenario: Annotation mode is dropped from a link to a preview trace
      Given a drawer link that asks for annotation mode on a sample preview trace
      When the drawer hydrates from that link
      Then the trace opens without annotation mode

    @integration
    Scenario: A sample preview trace is never offered for annotation
      Given I am reading a sample preview trace
      When I open the trace actions menu
      Then I do not see an action to annotate the trace

  Rule: While annotating, the reader stays on a view the pass can act on

    Usage and terminal replay an agent run rather than showing the trace's own
    spans, so there is nothing in them to correct and nothing in them to point a
    comment at. The conversation is not one of them: it is where commenting on a
    turn reads best, so it stays reachable.

    @unit
    Scenario: A link naming annotation mode and a view the pass cannot act on opens on the trace
      Given a link that asks for annotation mode and for the usage view
      When the drawer opens from it
      Then it opens on the trace view

    @integration
    Scenario: Views the pass cannot act on are unavailable while annotating
      Given I am annotating the trace
      Then the usage and terminal tabs cannot be opened
      And each explains that I need to finish annotating to switch views

  Rule: Annotating a trace is one pass over corrections and comments

    A reviewer reads a trace once. Making them choose between correcting it and
    commenting on it before they start splits one reading into two, and the
    second reading is the one nobody does. One mode carries both, and it is
    named after the job rather than after the half of it that came first.

    What can be commented on, and what the comment is recorded against, is
    specified in specs/traces-v2/anchored-comments.feature. This rule is only
    about the mode the reviewer is in while doing it.

    @integration
    Scenario: The overflow menu offers to edit the trace
      When I open the trace actions menu
      Then I see an action reading "Edit trace"
      And it needs the same permission to write annotations as correcting does
      # "Edit trace" rather than "Annotate trace": annotating now means leaving
      # an anchored comment right where the reader is, so the mode that also
      # corrects fields is named after editing.

    @integration
    Scenario: The bar names the mode and counts corrections and comments apart
      Given I am annotating the trace
      When I rename a span and leave a comment on another
      Then the bar names the mode as annotation mode
      And the bar reports one changed field
      And it reports the comment separately from the correction

    @integration @unimplemented
    Scenario: Correcting and commenting happen without leaving the mode
      Given I am annotating the trace
      When I correct a span output and comment on another span
      Then both are accepted in the same pass
      And I was never asked to choose between correcting and commenting

    @integration
    Scenario: The conversation stays reachable while annotating
      Given I am annotating the trace
      Then the conversation tab can be opened
      And the usage and terminal tabs still cannot

    @integration
    Scenario: Starting to annotate from the conversation leaves the reader there
      Given I am reading the conversation view
      When I start annotating the trace
      Then the conversation view is still shown

    @unit
    Scenario: A link asking to annotate on the conversation view opens on the conversation
      Given a link that asks to annotate the trace and for the conversation view
      When the drawer opens from it
      Then it opens on the conversation view

    @integration @unimplemented
    Scenario: A comment is saved as it is written, not when the correction is saved
      Given I am annotating the trace
      When I leave a comment on a span
      Then the comment is stored straight away
      And there is still nothing to save on the correction

    @integration @unimplemented
    Scenario: Saving the correction leaves the comments alone
      Given I am annotating the trace
      And I have left a comment on a span
      When I rename another span and save the correction
      Then the correction is stored with that rename
      And the comment is untouched by the save

    @integration
    Scenario: The discard prompt says it discards the corrections
      Given I am annotating the trace
      And I have renamed a span
      When I cancel
      Then I am asked whether to discard the trace corrections
      And the prompt says the comments are already saved

    @unit
    Scenario: Comments left in the pass are nothing to discard
      Given I am annotating the trace
      And I have left a comment and corrected nothing
      When I cancel
      Then I am not asked whether to discard anything
      And the drawer leaves the mode straight away

    @integration @unimplemented
    Scenario: Discarding the corrections keeps the comments
      Given I am annotating the trace
      And I have left a comment on a span
      And I have renamed another span
      When I cancel and confirm discarding
      Then the rename is gone
      And the comment is still on the span

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
    Scenario: Saving builds on the correction as it stands
      Given I am editing the trace
      And a correction was stored after I started editing
      And I have renamed a span
      When I save the correction
      Then the stored correction keeps what the other correction changed
      And it carries my rename as well

    @integration
    Scenario: A failed save keeps the reviewer in edit mode with their work
      Given I am editing the trace
      And I have renamed a span
      When saving the correction fails
      Then the drawer reports that the correction could not be saved
      And I am still editing with my changes intact

  Rule: An unsaved change reads where the reviewer made it

    @integration
    Scenario: A pending rename shows in the waterfall while editing
      Given I am editing the trace
      When I rename a span
      Then the waterfall lists that span under its new name
      And the row reads as edited

    @integration
    Scenario: A rename from an earlier correction still reads while editing
      Given the trace has a correction that renames a span
      When I start editing the trace
      Then the waterfall lists that span under its corrected name
      And the row still reads as edited

    @integration
    Scenario: A second correction starts from what the first one said
      Given the trace has a correction that renames a span
      When I open that span while editing
      Then the name editor shows the corrected name
      And correcting another field keeps that rename

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

    @integration
    Scenario: Closing the drawer with unsaved changes asks first
      Given I am editing the trace
      And I have renamed a span
      When I close the drawer
      Then I am asked whether to discard my changes

    @integration
    Scenario: Navigating to another trace with unsaved changes asks first
      Given I am editing the trace
      And I have renamed a span
      When I open a different trace
      Then I am asked whether to discard my changes

    @integration
    Scenario: Edit trace on another turn with unsaved changes asks first
      Given I am editing the trace
      And I have renamed a span
      When I choose "Edit trace" on another turn's separator
      Then I am asked whether to discard my changes
      And cancelling keeps the trace and the correction as they were

    @integration
    Scenario: Going back to an earlier trace with unsaved changes asks first
      Given I am editing a trace I opened from another one
      And I have renamed a span
      When I go back to the trace I came from
      Then I am asked whether to discard my changes
      And I am still on the trace I was correcting

    @integration
    Scenario: Browser back with unsaved changes keeps the correction
      Given I am editing the trace
      And I have renamed a span
      When I use the browser's back button
      Then the trace is still open with my changes
      And I am asked whether to discard them

    @unit
    Scenario: Touching a field and putting it back leaves nothing to save
      Given I am editing the trace
      When I rename a span and type its captured name back
      Then there is nothing to save
      And the field no longer reads as edited

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

    @integration
    Scenario: A redacted field carries no editor
      Given I am editing a span whose input is hidden from me
      Then the input cannot be edited

    @unit
    Scenario: The system prompt shown with the messages is not edited into them
      Given I am editing a span whose system prompt is recorded apart from its messages
      When I open the input editor
      Then the editor shows the messages without the system prompt

    @unit
    Scenario: A system prompt recorded as content blocks reads as one prompt
      Given a span whose system prompt is recorded as content blocks
      When I read its input and open the input editor
      Then the input panel shows the prompt once in front of the messages
      And the editor shows the messages without the system prompt

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
    Scenario: Adding an attribute with a key the span does not have records it
      Given I am editing a span with attributes
      When I add an attribute using a key the span does not have
      Then the correction carries that key and its value

    @integration
    Scenario: Adding an attribute rejects a key that already exists
      Given I am editing a span with attributes
      When I add an attribute using a key that already exists
      Then I am told the key already exists
      And the attribute is not added

    @integration
    Scenario: Adding an attribute rejects a key the filter is hiding
      Given I am editing a span with attributes
      And I have filtered the attributes down to a few rows
      When I add an attribute using a key the filter is hiding
      Then I am told the key already exists
      And the attribute is not added

    @integration
    Scenario: Adding an attribute rejects a key that sits inside another one
      Given I am editing a span carrying an attribute under a dotted path
      When I add an attribute whose key is a parent of that path
      Then I am told which attribute the key conflicts with
      And the attribute is not added
      And adding a key nested under an attribute that already holds a value is
      refused the same way

    @unit
    Scenario: An attribute changed before the stored correction arrives keeps it
      Given the trace has a correction that changes a span attribute
      And I change another attribute on that span before the correction is read
      When I save the correction
      Then it carries both attributes

    @integration
    Scenario: An attribute hidden from me carries no editor
      Given I am editing a span with an attribute I am not allowed to read
      Then that attribute cannot be edited

  Rule: The trace's own input is corrected beside its output

    @integration
    Scenario: The trace input carries an editor while editing
      Given I am editing the trace
      When I read the summary
      Then the trace input can be edited there
      And the trace output can be edited there

    @unit
    Scenario: Correcting the trace input counts as a change
      Given I am editing the trace
      When I rewrite the trace input
      Then there is one field to save
      And the correction carries the rewritten trace input

    @unit
    Scenario: Typing the trace input back leaves nothing to save
      Given I am editing the trace
      And I have rewritten the trace input
      When I type the captured input back
      Then there is nothing to save

    @integration
    Scenario: A redacted trace input carries no editor
      Given I am editing a trace whose input is hidden from me
      Then the trace input cannot be edited

  Rule: Trace metadata is corrected in place, except where it places the trace

    @integration
    Scenario: Changing a metadata value records it in the correction
      Given I am editing a trace with metadata
      When I change a metadata value
      Then the correction carries the new value for that key

    @integration
    Scenario: Removing a metadata key strikes it through and can be undone
      Given I am editing a trace with metadata
      When I remove a metadata key
      Then the metadata key reads as removed
      And I can restore it

    @integration
    Scenario: Adding a metadata key records it in the correction
      Given I am editing a trace with metadata
      When I add a metadata key the trace does not have
      Then the correction carries that key and its value

    @integration
    Scenario: The keys that place a trace carry no metadata editor
      Given I am editing a trace with metadata
      Then the conversation, user, customer and scenario run keys cannot be edited
      And the platform's own metadata cannot be edited
      And the trace's own labels can be edited

    @unit
    Scenario: Which metadata keys a reviewer may correct is one rule
      Given the metadata keys a trace can carry
      Then the platform namespace and the grouping keys are never editable
      And labels and keys the caller sent are editable

    @unit
    Scenario: Corrected metadata is saved as one map of the keys that changed
      Given I am editing a trace with metadata
      When I change one metadata value and remove another
      Then the correction names both keys and nothing else

    @unit
    Scenario: A metadata value put back leaves nothing to save
      Given I am editing a trace with metadata
      When I change a metadata value and type the captured one back
      Then there is nothing to save

  Rule: A correction carries only what the reviewer actually changed

    @unit
    Scenario: Correcting only the trace output stores no span correction
      Given I am editing the trace
      When I rewrite the trace output and save
      Then the correction names no span at all

    @unit
    Scenario: An attribute typed over and typed back stores no attribute correction
      Given I am editing a span with attributes
      When I change an attribute value and type the captured one back
      Then the correction names no span at all

    @unit
    Scenario: Retyping the captured text into an attribute recorded as text is not a change
      Given I am editing a span whose attribute holds a JSON document as text
      When I retype that document exactly as it was recorded
      Then there is nothing to save

    @integration
    Scenario: An attribute editor keeps the shape the trace recorded
      Given I am editing a span whose attribute holds a JSON document as text
      When I retype that document into the attribute editor
      Then the value recorded is still text, not a structure

    @integration
    Scenario: Only the attribute rows a correction really changed read as edited
      Given the trace has a correction that changes one span attribute
      Then only that attribute is highlighted as edited
      And the attributes the correction left alone carry no marker

    @integration
    Scenario: An attribute the correction unpacked from recorded text is not marked as added
      Given the trace has a correction that turned a recorded text attribute into a structure
      Then the rows underneath it are not marked as added by an edit

    @integration
    Scenario: Saving is refused once the drawer moved to another trace
      Given I am editing the trace
      And the drawer has moved to a different trace
      When the correction is saved
      Then nothing is written

    @unit
    Scenario: Opening a different trace drops the draft from the last one
      Given I am editing the trace
      And I have renamed a span
      When a different trace is opened
      Then there is nothing left to save

    @unit
    Scenario: Re-entering edit mode on the same trace keeps the draft
      Given I am editing the trace
      And I have renamed a span
      When edit mode is entered again for the same trace
      Then my rename is still there

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

    @integration
    Scenario: Each row's delete action names the span it removes
      Given I am editing a trace whose spans form a tree
      Then each span's delete action names that span

    @integration
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

    # The tint and the edge tick are the fast signal while scanning. The badge
    # carries the same fact to a reader who cannot separate the hues.
    @integration
    Scenario: A corrected span is marked in the tree
      Given the trace has a correction that renames a span
      When I read the corrected trace
      Then that row is marked as edited in words, not by colour alone

    @unit
    Scenario: The captured trace is a choice about the trace in front of me
      Given I switched to the captured trace
      When I open another trace
      Then it opens corrected

    # The corrected trace is where a reader goes to see what the correction did,
    # so a removal has to be visible there. A span that simply vanished would
    # read as a span that was never captured, and the reader would have to hold
    # both views in their head to notice anything went away at all. It stays on
    # the row it had, struck through and marked, which is the one rendering that
    # says "this was here and the correction takes it out".
    @integration
    Scenario: A deleted span is listed and struck through in the corrected trace
      Given the trace has a correction that deletes a span
      When I read the corrected trace
      Then that span is listed and marked as deleted
      And its name and its type are struck through

    # The tombstone says what the correction removes; it is not part of what the
    # corrected trace contains.
    @unit
    Scenario: The header counts the spans the corrected trace has
      Given the trace has a correction that deletes a span
      When I read the corrected trace
      Then the header counts one span fewer than was captured
      And the captured trace still counts them all

    # The captured trace is the trace as it arrived. Nothing the correction did
    # belongs on it, so a span the correction removes reads there exactly like
    # every span the correction never touched.
    @integration
    Scenario: A deleted span reads plainly in the captured trace
      Given the trace has a correction that deletes a span
      When I switch to the captured trace
      Then that span is listed with no deleted marker
      And its name is not struck through

    # Removal is the whole of the change, and the deleted marker says it. The
    # changed colour on the same row argues with it.
    @integration
    Scenario: A deleted span is not also coloured as changed
      Given the trace has a correction that deletes a span
      When I read the corrected trace
      Then that row does not carry the changed colour

    # The markers a correction adds sit beside the span name and take room from
    # it, so a renamed span is often the one whose name will not fit.
    @integration
    Scenario: A span name too long for its row can still be read in full
      Given a span whose name the tree is too narrow to spell out
      Then the name carries the whole of itself for the reader to read

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

    # An attribute the correction takes away is the same case as a span it takes
    # away: the corrected trace is where the removal has to be legible, and a row
    # that simply stopped existing is not.
    @integration
    Scenario: An attribute the correction removes is listed struck through
      Given the trace has a correction that removes a span attribute
      When I read the corrected trace
      Then that attribute is listed with its captured value struck through
      And it is marked as removed

    @integration
    Scenario: An attribute the correction removes reads plainly in the captured trace
      Given the trace has a correction that removes a span attribute
      When I switch to the captured trace
      Then that attribute is listed with no removed marker
      And its value is not struck through

    # A correction rewrites a whole attribute record, so an attribute holding
    # JSON comes back re-serialised even when the reviewer never touched it:
    # different spacing, different key order, the same data. Marking that as
    # edited teaches the reader to distrust the marker, which costs more than
    # the marker is worth.
    @integration
    Scenario: JSON that only changed its formatting is not marked as edited
      Given the trace has a correction that reformats an attribute holding JSON
      Then that attribute is not marked as edited

    @unit
    Scenario: Reordered JSON keys are not an edit
      Given a captured attribute and a corrected one holding the same keys in a
      different order
      Then they read as the same value

    @unit
    Scenario: Reordered JSON array entries are an edit
      Given a captured attribute and a corrected one holding the same array
      entries in a different order
      Then they read as different values

    @integration
    Scenario: A corrected span name names its captured name
      Given the trace has a correction that renames a span
      When I open that span
      Then the corrected name is highlighted as edited
      And it names the captured name

    @integration
    Scenario: A corrected span type names its captured type
      Given the trace has a correction that changes a span's type
      When I open that span
      Then the corrected type is highlighted as edited
      And it names the captured type

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

    @integration
    Scenario: The difference opens on the part of the trace that changed
      Given the trace has a correction that only changes a span
      When I open the difference view
      Then the span differences are shown
      And each part of the trace carries the lines it adds and removes
