# Trace View (Summary Tab) — Gherkin Spec
# Implementation:
#   langwatch/src/features/traces-v2/components/TraceDrawer/traceAccordions/TraceSummaryAccordions.tsx
#   langwatch/src/features/traces-v2/components/TraceDrawer/IOViewer.tsx
#   langwatch/src/features/traces-v2/components/TraceDrawer/AttributeTable.tsx
#   langwatch/src/features/traces-v2/components/TraceDrawer/useIOViewerState.ts
#
# Audited 2026-05-01:
#   - The drawer tab is "Summary" (`activeTab === "summary"`), not
#     "Trace Summary".
#   - Accordion section ids are: io | attributes | scope | evals | events
#     | exceptions. The header label "Attributes" was renamed to
#     "Metadata" in the UI; "Trace Attributes" / "Resource Attributes"
#     are sub-section labels inside that single accordion.
#   - Section order is computed: when error+IO both present →
#     [io, exceptions, attributes, evals, events]; when error only and no
#     IO → [exceptions, io, attributes, evals, events]; otherwise
#     [io, attributes, evals, events]. There's no Instrumentation Scope
#     accordion in the live render — the scope is shown as a chip above
#     the accordions when `resources.scope?.name` is set.
#   - I/O format toggle is a four-mode `ViewFormat`:
#     "pretty" | "text" | "json" | "markdown" (was three in the spec).
#   - Empty events accordion shows the `EmptyEventsState` component,
#     not the literal "No events recorded" string.

# ─────────────────────────────────────────────────────────────────────────────
# ACCORDION LAYOUT
# ─────────────────────────────────────────────────────────────────────────────

Feature: Trace view (summary tab)

Rule: Summary tab accordion layout
  The summary panel uses collapsible accordions that can be open simultaneously.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace is selected in the drawer

  Scenario: Summary tab is active by default when the drawer opens
    When the drawer opens with no `drawer.span` and no `drawer.tab` URL hint
    Then `drawerStore.activeTab === "summary"`
    And `<TraceSummaryAccordions>` renders below the SpanTabBar

  Scenario: Returning to the summary tab from a span tab
    Given a span tab is active
    When the user clicks the "Summary" tab (or presses O)
    Then `setActiveTab("summary")` runs and the summary accordions render

  Scenario: Clearing the span selection returns to summary
    Given a span tab is active
    When `clearSpan()` runs (X button, Escape, or empty-space click)
    Then `activeTab` is "summary" and the summary panel renders

  Scenario: Default accordion order with both error and I/O
    Given the trace status is "error" with an error message
    And the trace has either input or output
    Then the section order is: io, exceptions, attributes, evals, events

  Scenario: Default accordion order with error and no I/O
    Given the trace status is "error" and no input/output is captured
    Then the section order is: exceptions, io, attributes, evals, events

  Scenario: Default accordion order without an error
    Given the trace has status "ok" or "warning"
    Then the section order is: io, attributes, evals, events

  Scenario: Multiple accordions can be open at once
    Given the I/O accordion is open
    When the user opens the Events accordion
    Then both are open in `openSections`

  Scenario: User can manually open and close any accordion
    Given a section is open
    When the user clicks its header
    Then it toggles closed (and the new openSections is persisted via `useAutoOpenSections`)

  Scenario: Collapsed accordion shows item count badge
    Given the trace has 3 events
    And the Events accordion is collapsed
    Then the Events accordion header shows the count "3"

  Scenario: I/O and Metadata count badges
    Then the I/O ("Input and Output") section never shows a count badge
    And the Metadata section shows a count derived from `countFlatLeaves(traceAttributes) + countFlatLeaves(resourceAttributes)`


# ─────────────────────────────────────────────────────────────────────────────
# AUTO-OPEN RULES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Auto-open rules
  `useAutoOpenSections` opens every section that currently has content on
  identity change (new traceId), and adds newly-populated sections within
  the same identity. The "only I/O auto-opens" model from the original
  spec was never implemented.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Sections with content auto-open on first render
    Given a trace has I/O, trace attributes, evals, and events
    When the drawer opens
    Then the io, attributes, evals, and events accordions are all open
    And empty sections are closed

  Scenario: Metadata only auto-opens when trace attributes are present
    Given a trace has only resource attributes (no trace attributes)
    Then the Metadata accordion is closed initially
    # Resource-only attribute dumps are usually noise — see TraceSummaryAccordions L78-79

  Scenario: Exceptions auto-opens for errored traces
    Given a trace has status "error" with an error message
    When the drawer opens
    Then the exceptions accordion is open

  Scenario: Async-arriving content opens its section
    Given the drawer opened with no evals available yet
    When evals stream in for the same trace
    Then the evals accordion auto-opens
    And sections the user manually closed remain closed

  Scenario: User overrides persist within an identity
    Given the drawer is open with auto-open defaults
    When the user closes the I/O accordion
    Then the closed state is preserved across span-tab toggles for the same trace

  Scenario: Switching trace resets accordion state
    Given the user manually opened a section on trace A
    When the user opens trace B
    Then `useAutoOpenSections` resets to auto-open defaults for trace B


# ─────────────────────────────────────────────────────────────────────────────
# I/O SECTION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Trace I/O accordion
  The "Input and Output" accordion shows the trace's computed input + output
  via `<IOViewer>`. Each viewer instance is owned by its own
  `useIOViewerState`, so input and output can be in different formats.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace is selected in the drawer
    And the "Input and Output" accordion is open

  Scenario: I/O accordion mounts an IOViewer per side that has content
    Then an Input IOViewer is rendered when `trace.input` is non-empty
    And an Output IOViewer is rendered when `trace.output` is non-empty
    And the output viewer is constructed with `mode="output"`

  Scenario: Format toggle defaults to Pretty
    Then `useIOViewerState` initialises with `format = "pretty"`
    And the SegmentedToggle exposes "pretty" | "text" | "json" | "markdown"

  Scenario: Switching to Text mode shows raw content
    When the user selects the Text format toggle
    Then input/output render as raw plain text
    And no role icons or syntax highlighting are applied

  Scenario: Switching to JSON mode shows syntax-highlighted JSON
    When the user selects the JSON format toggle
    Then input/output render via `JsonHighlight`/`safePrettyJson`

  Scenario: Markdown mode has rendered/source sub-mode
    When the user selects the Markdown format
    Then a sub-toggle exposes `markdownSubmode = "rendered" | "source"`
    And "rendered" applies the Shiki adapter for code fences

  Scenario: Both viewers expose Copy and Annotate when traceId is provided
    Given the IOViewer was passed a `traceId` prop
    Then a copy-to-clipboard button is visible
    And Annotate + Suggest-correction actions are wired into the AnnotationPopover

  Scenario: Empty input/output is gracefully omitted
    Given the trace has no input
    Then no Input IOViewer is rendered
    Given the trace has no output
    Then no Output IOViewer is rendered
    Given the trace has neither
    Then the section body shows `<EmptyHint>No I/O captured for this trace</EmptyHint>`


# ─────────────────────────────────────────────────────────────────────────────
# I/O PRETTY MODE RENDERING
# ─────────────────────────────────────────────────────────────────────────────

Rule: I/O pretty mode rendering
  Pretty mode detects data shape and renders the most readable format.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace is selected in the drawer
    And the I/O accordion is open
    And the format toggle is set to Pretty

  Scenario: Chat messages array renders as conversation
    Given the input data is a JSON array where items have "role" and "content" fields
    Then the input renders as a conversation with role-labeled messages

  Scenario: Role icons match role values
    Given a chat messages array with system, user, assistant, and tool roles
    Then the system message shows a gear icon
    And the user message shows a person icon
    And the assistant message shows a bot icon
    And the tool message shows a wrench icon

  Scenario: Tool calls render with function name and arguments
    Given an assistant message contains a "tool_calls" array
    Then each tool call renders with its function name
    And the tool call arguments are displayed

  Scenario: Non-chat JSON renders as formatted key-value display
    Given the data is a JSON object without "role" fields
    Then the data renders as a formatted key-value display

  Scenario: Plain text renders with markdown formatting
    Given the data is a string that is not valid JSON
    Then the data renders as formatted text with markdown support

  Scenario: Markdown content is sanitized
    Given message content contains script tags or event handlers
    Then the rendered output strips script tags, iframes, and event handlers

  Scenario: Value type hint guides rendering but does not gate it
    Given the "langwatch.reserved.value_types" attribute hints "chat_messages"
    But the actual data does not match the chat messages shape
    Then the renderer falls back to the appropriate format based on actual data shape


# ─────────────────────────────────────────────────────────────────────────────
# I/O CONTENT DISPLAY RULES
# ─────────────────────────────────────────────────────────────────────────────

Rule: I/O content display rules
  Content display handles long text, truncation, and expand/collapse behavior.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace is selected in the drawer
    And the I/O accordion is open

  Scenario: Text mode limits visible height with scroll
    Given the format toggle is set to Text
    And the content exceeds the visible area
    Then the content area scrolls to reveal the rest

  Scenario: JSON mode provides expand and collapse controls
    Given the format toggle is set to JSON
    Then expand-all and collapse-all controls are available

  Scenario: Very long content is truncated at the IOViewer cap
    Given the content exceeds 100,000 characters
    Then the rendered body is truncated and an expander reveals the remaining tail
    # `TRUNCATE_AT = 100_000` and `TRUNCATE_TAIL_MIN = 1_000` in IOViewer.tsx;
    # the original spec's "5000 character" threshold was wrong.

  Scenario: Expanding truncated content shows the full text
    Given the content is truncated
    When the user clicks the "Show remaining …" expander
    Then the full content is displayed


# ─────────────────────────────────────────────────────────────────────────────
# I/O MULTIMODAL CONTENT
# ─────────────────────────────────────────────────────────────────────────────

# Not yet implemented as of 2026-05-01 — IOViewer's transcript layer does
# not branch on `image_url`/`audio` content types. Multimodal items are
# rendered as their JSON shape only.
@planned
Rule: I/O multimodal content rendering
  Multimodal content items render inline with type-appropriate displays.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace is selected in the drawer
    And the I/O accordion is open
    And the format toggle is set to Pretty

  Scenario: Image content renders as inline thumbnail
    Given a message content item has type "image_url"
    Then the image renders inline as a thumbnail with max width of 200px

  Scenario: Clicking an image thumbnail expands it
    Given an image thumbnail is displayed
    When the user clicks the thumbnail
    Then the image expands to full size

  Scenario: Unrecognized content type shows placeholder
    Given a message content item has an unrecognized type like "audio"
    Then a placeholder reads "Unsupported content type: audio"
    And the raw data is available in JSON mode


# ─────────────────────────────────────────────────────────────────────────────
# ATTRIBUTES SECTION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Trace metadata accordion
  Shows trace-level and resource attributes as key-value pairs via
  `<AttributeTable>`. The accordion's section title is "Metadata".

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace is selected in the drawer
    And the Metadata accordion is open

  Scenario: Section title reads "Metadata"
    Then the accordion header label reads "Metadata"

  Scenario: AttributeTable receives both attribute maps
    Then `<AttributeTable>` is rendered with `attributes={trace.attributes}`
    And `resourceAttributes={resources.resourceAttributes}` (or undefined when empty)
    And `title="Trace Attributes"` (rendered as a sub-section heading inside the table)

  # Pinned / promoted-attribute filtering happens in the chip strip; the
  # AttributeTable still renders the full set. The de-duplication promised
  # by the original spec is not enforced.
  @planned
  Scenario: Promoted attributes are not duplicated
    Given an attribute is promoted to the header chip strip
    Then that attribute does not appear in the Metadata accordion

  Scenario: Resources still loading
    Given resource attributes are still loading
    Then the section body shows `<EmptyHint>Loading metadata…</EmptyHint>`

  Scenario: No metadata captured
    Given the trace has no trace attributes and no resource attributes
    Then the section body shows `<EmptyHint>No metadata recorded</EmptyHint>`
    And the section is collapsed by default


# ─────────────────────────────────────────────────────────────────────────────
# EXCEPTIONS SECTION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Trace exceptions accordion
  Shows the trace's top-level error message. The current implementation
  renders a single red-tinted block with the trace's `error` text — it does
  NOT iterate over per-span exception entries.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace is selected in the drawer

  Scenario: Exceptions accordion is rendered only when there is an error
    Given the trace status is "error" with an error message
    Then the exceptions section is included in the section list
    Given the trace has no error
    Then no exceptions section is rendered

  Scenario: Exceptions section shows the trace error in a red-tinted block
    Given the Exceptions accordion is open
    Then a red-tinted HStack shows a `LuCircleX` icon and the trace's `error` text
    And the text is rendered with `fontFamily="mono"` and `whiteSpace="pre-wrap"`

  # The bullet-per-exception model with type, message, timing, stack trace,
  # span origin link, and hover-highlight is not implemented today.
  @planned
  Scenario: Per-exception list with type, message, timing, and stack trace
    Given the trace has multiple span-level exceptions
    Then each exception is listed with type, message, timing offset, and a collapsible stack trace

  @planned
  Scenario: Exceptions sorted by timestamp ascending
    Given the trace has exceptions at +0.5s and +1.2s
    Then the exception at +0.5s appears before the exception at +1.2s

  @planned
  Scenario: Exception span-origin link
    Given an exception originated from a named span
    Then a "from <span name>" link is shown next to the exception

  @planned
  Scenario: Hovering span origin link highlights the span in the visualization
    Given an exception has a span-origin link
    When the user hovers the link
    Then the corresponding span is highlighted in the visualisation


# ─────────────────────────────────────────────────────────────────────────────
# EVENTS SECTION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Trace events accordion
  Shows informational events hoisted from all spans within the trace.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace is selected in the drawer
    And the Events accordion is open

  Scenario: Each event renders name and timing offset
    Given the trace has events
    Then each event row shows the event name (medium weight)
    And a "+Nms" offset computed as `evt.timestamp - trace.timestamp`
    And a "View span" button when an `onSelectSpan` callback is wired

  Scenario: Events render in `traceEvents` order
    Given `trace.events` contains entries at +100ms and +1200ms
    Then they appear in the order delivered by the server
    # The component does not re-sort events; ordering depends on the
    # backend response. Original spec promised "by timestamp ascending"
    # — accurate for normal data but not enforced client-side.

  Scenario: Clicking "View span" opens that span tab
    When the user clicks "View span" on an event row
    Then `onSelectSpan(evt.spanId)` is invoked
    And the SpanTabBar focuses that span

  Scenario: No events shows empty state component
    Given the trace has no events
    Then the section body renders `<EmptyEventsState />`

  # The following affordances are not yet implemented:
  @planned
  Scenario: Event icon and span-origin "from <span>" link
    Given an event originates from a named span
    Then the event row shows an info icon and a "from <span>" link

  @planned
  Scenario: Hovering event span-origin link highlights the span in the visualization
    Given an event has a span-origin link
    When the user hovers the link
    Then the corresponding span is highlighted in the visualisation

  @planned
  Scenario: Event attributes render as a collapsible key-value block
    Given an event has attributes
    Then a collapsible block under the event renders the attributes (Flat/JSON toggle)

  @planned
  Scenario: User feedback events get a thumbs-up icon
    Given the trace has a `user.feedback` thumbs-up event
    Then the event row shows a thumbs-up icon


# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Trace summary data gating
  Empty or missing data is handled gracefully with appropriate messaging.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace is selected in the drawer

  Scenario: No input or output shows EmptyHint
    Given the trace has no input and no output
    Then the I/O section renders `<EmptyHint>No I/O captured for this trace</EmptyHint>`

  Scenario: No metadata shows EmptyHint
    Given the trace has no trace attributes and no resource attributes
    Then the Metadata section renders `<EmptyHint>No metadata recorded</EmptyHint>`

  Scenario: No exceptions hides the section entirely
    Given the trace has no error
    Then no exceptions section is added to the section list

  Scenario: No events renders EmptyEventsState
    Given the trace has no events
    Then the Events section body renders `<EmptyEventsState />`

  Scenario: Estimated cost shows approximate prefix
    Given the trace cost is estimated
    Then the header cost MetricPill shows the cost with a "~" prefix


# ─────────────────────────────────────────────────────────────────────────────
# STATE PERSISTENCE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Summary accordion state persistence
  `useAutoOpenSections` keeps the open-set in `useState` keyed by `traceId`,
  so user toggles within the same trace stick across tab switches; switching
  trace identity resets to the auto-open defaults.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace is selected in the drawer

  Scenario: Accordion state persists across tab switches
    Given the user manually opened the Events accordion
    And the user manually closed the I/O accordion
    When the user switches to a span tab
    And the user switches back to the Summary tab
    Then the Events accordion is still open
    And the I/O accordion is still closed

  Scenario: Opening a different trace resets accordion state
    Given the user manually opened a section on the current trace
    When the user opens a different trace (identity changes)
    Then `useAutoOpenSections` re-derives the open list from the new trace's content map
