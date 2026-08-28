# Anchored comments: saying something about one part of a trace
#
# Implementation:
#   packages/prisma-client/prisma/schema.prisma                                                  (which part of the trace an annotation is about)
#   platform/app/src/server/api/routers/annotation.ts                                            (anchored writes, anchored reads, suggestion hand-off)
#   platform/app/src/server/traces/edit-overlay/traceEditOverlay.service.ts                       (a field suggestion merged into the correction)
#   platform/app/src/server/traces/clickhouse-trace.service.ts                                   (trace-level annotation reads for lists and datasets)
#   packages/features/trace/web/src/annotation-draft.store.ts                           (what is being written, and about what)
#   platform/app/src/features/traces-v2/hooks/useConversationAnnotations.ts                       (comments grouped by trace and by anchor)
#   platform/app/src/features/traces-v2/components/TraceDrawer/waterfallView/TreeRow.tsx          (comment on a span)
#   platform/app/src/features/traces-v2/components/TraceDrawer/waterfallView/WaterfallView.tsx    (scrolling to an anchored span)
#   platform/app/src/features/traces-v2/components/TraceDrawer/IOViewer.tsx                       (comment on a span or trace field)
#   platform/app/src/features/traces-v2/components/TraceDrawer/AttributeTable.tsx                 (comment on an attribute row)
#   platform/app/src/features/traces-v2/components/TraceDrawer/traceAccordions/AccordionShell.tsx (comment on a section)
#   platform/app/src/features/traces-v2/components/TraceDrawer/transcript/parsing.ts              (stable identity for a message)
#   platform/app/src/features/traces-v2/components/TraceDrawer/transcript/BlockStack.tsx          (comment on a message)
#   platform/app/src/features/traces-v2/components/TraceDrawer/transcript/messageComments.tsx     (which trace a transcript belongs to)
#   platform/app/src/features/traces-v2/components/TraceDrawer/conversationView/ChatTurnRow.tsx            (comment on one side of a turn)
#   platform/app/src/features/traces-v2/components/TraceDrawer/conversationView/MessageAnnotateCluster.tsx (the affordance on a message)
#   platform/app/src/features/traces-v2/components/TraceTable/registry/addons/conversation/Bubble.tsx      (the same affordance in bubbles layout)
#   platform/app/src/features/traces-v2/components/TraceDrawer/conversationView/AnnotationCard.tsx        (what a card is about)
#   platform/app/src/features/traces-v2/components/TraceDrawer/conversationView/AnnotationScoreFields.tsx (scores ride any comment)
#   platform/app/src/features/traces-v2/components/TraceDrawer/TraceHeaderChips.tsx               (every comment on the trace, with its anchor)
#
# Motivation: a reviewer reading a trace can only ever say something about the
# whole trace. There is no way to point at the tool call that misfired, at the
# attribute that is wrong, or at the one message in a transcript that went off,
# so the comment ends up describing its own target in prose ("the third search
# call returned nothing") and the next reader has to find it again by hand.
# Corrections already have that precision: they patch a named span and a named
# field. Comments need the same reach, because the workflow is read a trace,
# mark what is wrong, and hand it on.
#
# Decisions:
#   - A comment is about the whole trace or about one part of it. The part is
#     recorded beside the comment, not quoted into it, so the comment keeps
#     reading correctly when the value it points at is long, redacted, or later
#     corrected.
#   - Anchors stop at the element the reader can point at: a span, a field of a
#     span or of the trace, an attribute row, a section, a turn, a message. A
#     range of characters inside a value is not an anchor.
#   - The anchor is fixed when the comment is written. Editing a comment changes
#     what it says, never what it is about, so a card can never quietly start
#     describing a different part of the trace than the one its author read.
#   - Every new comment names its target. A comment about "the whole trace"
#     said less than the reviewer knew, so the composer now always writes an
#     anchored comment; the ones written before anchoring existed keep reading
#     and editing exactly as they did.
#   - Scores ride any comment and stay a judgement about the whole trace. A
#     score is a project-wide key that becomes a dataset column for the trace;
#     it saves on the comment the reviewer was writing, wherever that comment
#     is anchored, and reads back trace-level everywhere.
#   - A comment on a field may carry the correction it is asking for, and that
#     correction becomes the trace's correction for exactly that field. An
#     attribute row and a message take a comment only, because there is nothing
#     for a suggestion on them to correct.
#   - A turn in the conversation is a trace, so its two sides are the trace's own
#     input and output. Commenting on one of them is commenting on a field, and
#     it reads in the turn's rail rather than in a popover: that is the same
#     column every remark about the turn reads in, and they belong together.
#     Both sides carry corrections: suggesting what the user's message should
#     have been corrects the trace's input the same way suggesting a better
#     reply corrects its output.
#   - A card in a turn's rail names the part without repeating the turn: it is
#     already beside the turn it belongs to, so "Input" is the whole of what the
#     reader needs and "Trace · Input" is one word of noise on every card.
#   - Every surface that reads a trace's annotations reads all of them, each
#     one naming its target: the annotations list and its export, the
#     annotation queue, the trace projections that feed the table and the
#     dataset columns, and the REST list endpoints. Anchored comments are the
#     primary annotation now, so a list that hid them answered with silence
#     exactly when a reviewer had spoken. What keeps the surfaces readable is
#     the label, not a filter; the API takes an anchor scope for callers who
#     want the old trace-only read.
#   - An anchor that no longer resolves is a designed state, not a bug. A span
#     a correction deleted, or a message whose content changed, leaves a comment
#     that still reads in the trace's comment list, says it is about a part that
#     is no longer there, and puts no count anywhere in the trace.
#   - No new error code. An anchor this build does not recognise, and an anchor
#     that no longer resolves, both degrade to something readable rather than
#     failing the list the reader asked for.
#   - The trace view grows no rail. At the width the drawer opens at, the
#     waterfall and the span detail already share the space, so a comment there
#     is a count at its anchor that opens the thread.
#   - The waterfall row and the attribute row keep their actions one click away on
#     hover rather than folding them behind a three-dot menu. That is a deliberate
#     exception to the row-actions rule, which is written for settings tables:
#     these rows are the reading surface of the drawer, they already carry delete
#     inline, and a menu would put every one of them a click further
#     away in the one place a reviewer works fastest. The exception is paid for
#     rather than assumed: an action with no room for a visible label has to name
#     the row it acts on, the way the row's delete action already does, so a
#     reader who never sees the icons still knows what each one does. Everywhere
#     there is room, the action carries its label as text.

Feature: Commenting on one part of a trace
  As a reviewer marking up a trace for whoever picks it up next
  I want to leave a comment on the exact span, field, attribute or message that
  is wrong
  So that the next reader lands on what I was looking at instead of hunting for
  it, and the surfaces that read whole traces stay readable

  Background:
    Given I am signed in to a project with permission to write annotations
    And I have a trace open in the trace drawer

  Rule: Anything a reviewer can read is something they can comment on

    The reader points at what they are already looking at. Every affordance
    below records which part of the trace the comment is about, so the comment
    never has to describe its own target in prose.

    @integration
    Scenario: Commenting on a span records the span it was left on
      When I comment on a span in the waterfall
      Then the comment is saved as being about that span
      And what the span held is not copied into the comment

    @integration
    Scenario: Commenting on a span's output records the field it was left on
      When I comment on a span's output
      Then the comment is saved as being about that span's output
      And a comment left on its input is saved as being about the input instead

    @integration
    Scenario: Commenting on an attribute row records that attribute
      Given I am reading a span with attributes
      When I comment on one attribute row
      Then the comment is saved as being about that attribute
      And a row open for correction offers no comment action until it is closed

    @integration
    Scenario: Commenting on the trace's own input, output or metadata records which one
      When I comment on the trace input
      Then the comment is saved as being about the trace input
      And the trace output and the trace metadata can each be commented on the
      same way

    @integration @unimplemented
    Scenario: Commenting on a section records that section
      Given I am reading a span whose detail is split into sections
      When I comment on a section header
      Then the comment is saved as being about that section
      And the header shows how many comments that section carries

    @integration
    Scenario: A comment written before anchoring still reads and edits as a comment about the whole turn
      Given a turn whose trace carries a comment written before comments had targets
      When I read the conversation
      Then that comment reads in the turn's rail as a comment about the whole turn
      And editing it changes what it says and nothing else

    @integration
    Scenario: Commenting on one side of a turn records which side it was left on
      Given I am reading the conversation
      When I comment on the message the user sent
      Then the comment is saved as being about that turn's input
      And a comment left on the reply is saved as being about its output

    @integration
    Scenario: Either side of a turn takes a comment and a correction
      Given I am reading the conversation
      Then the user's message offers a comment and a correction of what it should have been
      And the reply offers a comment and a correction as well

    @integration
    Scenario: A side of a turn a privacy rule hid offers nothing to comment on
      Given I am reading a conversation whose turn had its input hidden from me
      Then that side of the turn carries no comment action

    @integration
    Scenario: Commenting on one message in a transcript records that message
      Given I am reading a span whose input is a transcript of several messages
      When I comment on one of those messages
      Then the comment is saved as being about that message
      And the other messages carry no comment

    @unit
    Scenario: A message keeps the same identity when the transcript is read again
      Given a transcript read once and read again with the same content
      Then each message is recognised as the same message
      And a message whose content changed is not recognised as the one before it

    @integration
    Scenario: A field hidden from the reader carries no comment action
      Given I am reading a span whose input is hidden from me
      Then that input cannot be commented on
      And an attribute I am not allowed to read cannot be commented on either

    @integration
    Scenario: A reviewer who may only read annotations is offered no comment action
      Given I may read annotations but not write them
      Then no span, field, attribute, section or message offers to be commented on
      And the comments already on the trace are still readable

    @integration
    Scenario: A comment action with no room for a label names the row it acts on
      Given I am reading a span with attributes
      Then the comment action on a waterfall row names the span it comments on
      And the comment action on an attribute row names that attribute
      And a row's actions stay one click away on the row itself,
      rather than moving behind a menu
      # The waterfall and the attribute table are the reading surface of the
      # drawer, so the actions on them stay one click, and pay for it by naming
      # what they act on.

    @integration
    Scenario: A comment action with room for a label carries one
      Given I am reading a span's output and the section headers around it
      Then the comment action reads as a comment action in words

    # An action that is not on screen must not spend the row's width either:
    # the span name gets the room until the pointer asks for the actions.
    @integration
    Scenario: A waterfall row's hidden actions take none of the name's room
      Given I am reading a span whose name fills its column
      And my pointer is not on its row
      Then the name runs to the end of the column, not shortened for hidden actions
      And the comment action takes no room until the pointer is on the row
      And a row carrying comments keeps that count visible and roomed

    # Over the row, the actions covered the name they belong to and the marks
    # beside it. Below it, the row reads while they are on screen.
    @integration
    Scenario: The actions the pointer asks for read below the span's name
      Given I am reading a span whose name fills its column
      When my pointer arrives on its row
      Then its actions read below the span's name and model
      And the name, its marks and the row's figures stay where they were

    # Pinning a span makes it a tab, which is a thing only the tab says. On the
    # row the same icon named nothing a reader could act on.
    @integration
    Scenario: A waterfall row neither offers pinning nor reports it
      Given a span is pinned as a tab
      Then its waterfall row carries no pin action and no pinned mark

  Rule: A comment says what it is about

    @integration
    Scenario: A comment card names the part of the trace it is anchored to
      Given a span carries a comment about its output
      When I read that comment
      Then the card names the span and the field the comment is about

    @integration
    Scenario: A comment about the whole trace names nothing to jump to
      Given the trace carries a comment about the trace as a whole
      When I read that comment
      Then the card names no part of the trace

    @integration
    Scenario: The trace's whole comment list names what each comment is about
      Given the trace carries comments on a span, on an attribute and on the trace itself
      When I open the trace's comments from the header
      Then each comment is listed with the part of the trace it is about
      And the one about the trace itself is listed without a part

    @integration
    Scenario: A comment cannot be moved to another part of the trace
      Given a span carries a comment I wrote about its output
      When I edit that comment
      Then I can change what it says
      And it is still about that span's output when it is saved again

  Rule: Comments read where the thing they are about is

    @integration
    Scenario: A commented span carries a count on its row and opens its thread there
      Given a span carries two comments
      When I read the waterfall
      Then that span's row shows it carries two comments
      And opening the count shows both comments and offers to add another

    @integration
    Scenario: The trace view grows no rail for comments
      Given several spans of the trace carry comments
      When I read the trace view
      Then the waterfall and the span detail keep the width they had
      And no column is reserved for comments

    @integration
    Scenario: A commented part of a turn reads beside that turn
      Given a turn's trace carries a comment about one of its spans
      When I read the conversation in thread layout
      Then that comment is listed in the rail beside that turn
      And it names the span it is about

    @integration
    Scenario: A card about the turn's own input or output names only the field
      Given a turn carries a comment about its output
      When I read that comment in the turn's rail
      Then the card names the output and does not repeat the turn

    @integration
    Scenario: Commenting on a side of a turn writes in that turn's rail
      Given I am reading the conversation
      When I comment on the reply
      Then the composer opens in the rail beside that turn
      And the composer names the part the comment is about

    @unit
    Scenario: A comment about a span of a turn is not written in that turn's rail
      Given a comment is being written about one span of a turn
      Then the turn's rail holds no composer for it
      # The composer belongs where the part is read. A span is read in the trace
      # view, so its composer opens there and the rail stays free to start a
      # comment about the turn.

    @integration
    Scenario: Each side of a turn shows the comments left on it
      Given a turn carries a comment about its input and two about its output
      When I read the conversation
      Then the message the user sent shows one comment
      And the reply shows the two left on it

    @integration
    Scenario: Comments are readable without starting to annotate
      Given spans and fields of the trace carry comments
      When I read the trace without entering annotation mode
      Then every comment is readable where it was left

  Rule: Jumping to an anchor puts the anchored part on screen

    A comment that names a span is only useful if naming it takes the reader
    there. Selecting the span is not enough on its own: a long trace can leave
    the selected row hundreds of rows off screen.

    @integration
    Scenario: Jumping to a span comment selects that span and brings its row into view
      Given the trace has more spans than the waterfall shows at once
      And a span far down the trace carries a comment
      When I jump to that comment's span
      Then that span is selected
      And the waterfall has scrolled far enough to show its row

    @integration
    Scenario: Jumping to a comment on a field opens the part of the detail holding it
      Given a span carries a comment about its output
      And that span's output section is collapsed
      When I jump to that comment's field
      Then the section holding the output is open
      And it is briefly highlighted so the reader can see where they landed

    @integration
    Scenario: Jumping to a span comment from the conversation moves to the trace view
      Given I am reading the conversation
      And a turn's trace carries a comment about one of its spans
      When I jump to that comment's span
      Then the trace view is shown with that span selected

    @integration @unimplemented
    Scenario: Jumping to a comment on a message brings that message into view
      Given a span's transcript carries a comment on a message far down it
      When I jump to that comment's message
      Then that message is shown and briefly highlighted

  Rule: A comment whose anchor is gone says so rather than pointing somewhere wrong

    @integration
    Scenario: A comment on a span a correction deleted reads as being on a part that is no longer there
      Given a span carries a comment
      And a correction deletes that span
      When I open the trace's comments from the header
      Then the comment is still listed
      And it reads as being about a part of the trace that is no longer there

    @integration @unimplemented
    Scenario: A comment on a message whose content changed reads the same way
      Given a message in a transcript carries a comment
      And a correction rewrites that message
      When I open the trace's comments from the header
      Then the comment reads as being about a part of the trace that is no longer there

    @integration
    Scenario: A comment whose anchor is gone puts no count anywhere in the trace
      Given a comment about a part of the trace that is no longer there
      When I read the trace
      Then no row, section or attribute shows a count for it
      And nothing else is marked as commented in its place

    @integration
    Scenario: A comment whose anchor is gone offers nowhere to jump to
      Given a comment about a part of the trace that is no longer there
      When I read it in the trace's comment list
      Then it offers no jump

    @integration
    Scenario: A comment about something this build does not recognise still reads
      Given a comment recorded against a kind of part this build does not know
      When I open the trace's comments
      Then the list is returned
      And that comment reads as a comment about the trace as a whole

  Rule: A comment on a field can carry the correction it is asking for

    Saying "this output is wrong" and saying what it should have been are one
    thought, and the reviewer is already looking at the field. The comment stays
    the record of who asked; the correction is what the dataset reads.

    @integration
    Scenario: A suggestion left with a comment on a span output becomes that span's correction
      Given a trace with no correction
      When I comment on a span's output and suggest what it should have said
      Then the comment records my suggestion
      And the trace has a correction whose output for that span is my suggestion

    @unit
    Scenario: A suggestion on one field leaves the rest of the correction alone
      Given a stored correction that renames one span and deletes another
      When a suggestion on a third span's output is merged into it
      Then the rename and the deletion survive the merge
      And only that span's output is added

    @integration
    Scenario: A field suggested through a comment reaches the dataset
      Given a span output corrected through a comment's suggestion
      When the trace is mapped into a dataset row
      Then the row carries the suggested output rather than the captured one

    @integration
    Scenario: A suggestion on the trace's own input becomes the corrected trace input
      Given a trace with no correction
      When I comment on the message the user sent and suggest what it should have been
      Then the comment records my suggestion
      And the trace has a correction whose input is my suggestion

    @integration
    Scenario: A comment on an attribute row offers no suggestion
      Given I am commenting on an attribute row
      Then I am not offered a correction to go with the comment

    @integration
    Scenario: A comment on a message offers no suggestion
      Given I am commenting on a message in a transcript
      Then I am not offered a correction to go with the comment

  Rule: Scores ride any comment and stay a judgement about the whole trace

    @integration
    Scenario: A comment on one part of a trace is offered the same scores
      Given the project has active annotation score keys
      When I comment on a span
      Then the scores are offered on the comment

    @integration
    Scenario: Scores given with an anchored comment save on that comment and read trace-level
      Given the project has active annotation score keys
      When I comment on the reply of a turn and rate a score
      Then the score is saved with my comment
      And it reads wherever the trace's scores read

  Rule: The surfaces that read whole traces read every comment, labelled

    Hiding anchored comments kept these surfaces tidy and made them dishonest:
    a reviewer who marked one message of a trace had annotated it, and the
    annotations list said nothing had happened. Each surface below reads every
    comment and says what each one is about; the label is what keeps six span
    comments on one trace readable, not a filter.

    @integration
    Scenario: The project's annotations list holds every comment with its target named
      Given a trace with one comment about the trace and three comments about its spans
      When I read the project's annotations list
      Then all four comments are listed for that trace
      And each anchored one names the part it is about

    @integration
    Scenario: Exporting the annotations list exports the rows the list shows
      Given a trace with one comment about the trace and three comments about its spans
      When I export the annotations list
      Then the export holds the same four comments the list showed

    @integration
    Scenario: A queue item carries every comment about its trace
      Given a queue item on a trace with one comment about the trace and three about its spans
      When I read the queue
      Then the item carries all four comments

    @integration
    Scenario: A turn's annotation count counts what was said about the turn
      Given a turn's trace carries one comment about the turn and two about its spans
      When I read the conversation
      Then the turn's count reads as one
      And the comments about its spans are still listed beside the turn

    @integration
    Scenario: A dataset column of annotations carries every comment, each naming its target
      Given a trace with one comment about the trace and three comments about its spans
      When the trace is mapped into a dataset row
      Then the annotations column holds all four comments
      And each anchored one names the part it is about

    @integration
    Scenario: The annotations API returns every annotation by default
      Given a trace with one comment about the trace and three comments about its spans
      When a caller reads the annotations for that trace
      Then it receives all four comments
      And it can ask for only the trace-level ones instead, and receive the one

    @integration
    Scenario: A trace commented only on one of its spans still counts as annotated
      Given a trace whose only comment is about one of its spans
      When I filter the traces down to the annotated ones
      Then that trace is among them
      # Whether a human has touched a trace at all is a different question from
      # what they said about the trace as a whole, and this is the one place the
      # answer is deliberately yes.

  Rule: A comment on part of a trace is not a piece of work to hand out

    @integration
    Scenario: A comment on one part of a trace never becomes a queue item
      Given a trace carrying comments on three of its spans
      When the annotation queue is read
      Then none of those comments is an item in it

    @integration
    Scenario: Sending a commented trace to a queue sends the trace once
      Given a trace carrying comments on three of its spans
      When I add that trace to an annotation queue
      Then the queue holds one item for that trace
