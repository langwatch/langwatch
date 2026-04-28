# Trace View (Trace Summary Tab) — Gherkin Spec
# Based on PRD-005: Trace View (Trace Summary Tab)
# Covers: accordion layout, I/O rendering, attributes, exceptions, events, auto-open rules, data gating, state persistence

# ─────────────────────────────────────────────────────────────────────────────
# ACCORDION LAYOUT
# ─────────────────────────────────────────────────────────────────────────────

Feature: Trace summary accordion layout
  The trace detail section uses collapsible accordions that can be open simultaneously.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace is selected in the drawer

  Scenario: Trace summary tab is active by default when the drawer opens
    When the trace drawer opens
    Then the Trace Summary tab is active
    And the detail section renders below the visualization

  Scenario: Returning to the trace summary tab from a span tab
    Given the user is viewing a span tab
    When the user clicks the "Trace Summary" tab
    Then the Trace Summary detail section renders

  Scenario: Closing a span tab returns to trace summary
    Given the user is viewing a span tab
    When the user closes the span tab
    Then the Trace Summary tab becomes active

  Scenario: Accordions appear in the correct order
    When the Trace Summary tab is active
    Then the accordions appear in order: I/O, Attributes, Exceptions, Events, Evals

  Scenario: Multiple accordions can be open at once
    Given the I/O accordion is open
    When the user opens the Events accordion
    Then both I/O and Events accordions are open

  Scenario: User can manually open and close any accordion
    Given the I/O accordion is open
    When the user clicks the I/O accordion header
    Then the I/O accordion closes

  Scenario: Collapsed accordion shows item count badge
    Given the trace has 3 events
    And the Events accordion is collapsed
    Then the Events accordion header reads "Events (3)"

  Scenario: Expanded accordion hides item count badge
    Given the trace has 3 events
    And the Events accordion is expanded
    Then the Events accordion header reads "Events" without a count

  Scenario: I/O and Attributes accordions do not show count badges
    When the Trace Summary tab is active
    Then the I/O accordion header does not show a count badge
    And the Attributes accordion header does not show a count badge


# ─────────────────────────────────────────────────────────────────────────────
# AUTO-OPEN RULES
# ─────────────────────────────────────────────────────────────────────────────

Feature: Trace summary auto-open rules
  Accordions auto-open based on trace context to surface the most relevant data.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Normal trace opens only I/O
    Given a trace with no errors, no failed evals, and has I/O
    When the trace drawer opens
    Then the I/O accordion is open
    And the Attributes, Exceptions, Events, and Evals accordions are closed

  Scenario: Trace with error auto-opens Exceptions
    Given a trace that has errors
    When the trace drawer opens
    Then the I/O accordion is open
    And the Exceptions accordion is open
    And the Attributes, Events, and Evals accordions are closed

  Scenario: Trace with failed eval auto-opens Evals
    Given a trace that has a failed evaluation
    When the trace drawer opens
    Then the I/O accordion is open
    And the Evals accordion is open
    And the Attributes, Exceptions, and Events accordions are closed

  Scenario: Trace opened from the Errors preset auto-opens Exceptions
    Given the user navigated from the Errors filter preset
    When the trace drawer opens
    Then the I/O accordion is open
    And the Exceptions accordion is open

  Scenario: Trace with no I/O opens Attributes instead
    Given a trace with no input and no output
    When the trace drawer opens
    Then the I/O accordion is closed
    And the Attributes accordion is open

  Scenario: User overrides persist within a drawer session
    Given the trace drawer is open with auto-open defaults
    When the user manually closes the I/O accordion
    And the user switches to a span tab and back to Trace Summary
    Then the I/O accordion remains closed

  Scenario: Opening a new trace resets accordion state
    Given the user manually opened the Events accordion on trace A
    When the user selects a different trace B that is a normal trace
    Then the accordion state resets to auto-open defaults for trace B
    And the Events accordion is closed


# ─────────────────────────────────────────────────────────────────────────────
# I/O SECTION
# ─────────────────────────────────────────────────────────────────────────────

Feature: Trace I/O accordion
  Shows computed input and output for the entire trace with format toggling.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace is selected in the drawer
    And the I/O accordion is open

  Scenario: I/O accordion shows input and output sections
    Then the I/O accordion contains an INPUT section
    And the I/O accordion contains an OUTPUT section

  Scenario: Format toggle defaults to Pretty mode
    Then the format toggle shows Pretty as the active mode
    And Text and JSON modes are available

  Scenario: Switching to Text mode shows raw content
    When the user selects the Text format toggle
    Then input and output render as raw plain text
    And no formatting, role icons, or syntax highlighting is applied

  Scenario: Switching to JSON mode shows raw JSON
    When the user selects the JSON format toggle
    Then input and output render as syntax-highlighted JSON
    And collapsible nodes are available for nested structures

  Scenario: Copy-to-clipboard on each section
    Then a copy-to-clipboard button is visible on the INPUT section
    And a copy-to-clipboard button is visible on the OUTPUT section

  Scenario: Empty input shows placeholder
    Given the trace has no input
    Then the INPUT section shows "No input captured" in muted text

  Scenario: Empty output shows placeholder
    Given the trace has no output
    Then the OUTPUT section shows "No output captured" in muted text


# ─────────────────────────────────────────────────────────────────────────────
# I/O PRETTY MODE RENDERING
# ─────────────────────────────────────────────────────────────────────────────

Feature: I/O pretty mode rendering
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

Feature: I/O content display rules
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

  Scenario: Long text content truncates with expander
    Given the format toggle is set to Text
    And the content exceeds 5000 characters
    Then the content is truncated
    And a "Show full output" expander is visible

  Scenario: Expanding truncated content shows the full text
    Given the content is truncated
    When the user clicks "Show full output"
    Then the full content is displayed


# ─────────────────────────────────────────────────────────────────────────────
# I/O MULTIMODAL CONTENT
# ─────────────────────────────────────────────────────────────────────────────

Feature: I/O multimodal content rendering
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

Feature: Trace attributes accordion
  Shows trace-level and resource attributes as key-value pairs.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace is selected in the drawer
    And the Attributes accordion is open

  Scenario: Attributes accordion label reads "Trace Attributes"
    Then the section label reads "Trace Attributes"

  Scenario: Two sub-sections for trace and resource attributes
    Then a "Trace Attributes" sub-section shows attributes from the root span
    And a "Resource Attributes" sub-section shows resource attributes

  Scenario: Promoted attributes are not duplicated
    Given an attribute is promoted to the trace header
    Then that attribute does not appear in the Attributes accordion

  Scenario: Flat/JSON toggle is available
    Then a Flat/JSON toggle is available for attribute display

  Scenario: Search and filter within attributes
    When the user types a search term in the attributes filter
    Then only attributes matching the search term are shown

  Scenario: Copy-to-clipboard per attribute value
    Then each attribute value has a copy-to-clipboard button

  Scenario: No attributes shows empty message
    Given the trace has no attributes
    Then the Attributes section shows "No attributes recorded"
    And the accordion is auto-closed


# ─────────────────────────────────────────────────────────────────────────────
# EXCEPTIONS SECTION
# ─────────────────────────────────────────────────────────────────────────────

Feature: Trace exceptions accordion
  Shows exceptions hoisted from all spans within the trace.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace is selected in the drawer

  Scenario: Exceptions accordion is hidden when there are no exceptions
    Given the trace has no exceptions
    Then the Exceptions accordion is not visible

  Scenario: Exceptions accordion shows exception count
    Given the trace has 2 exceptions
    And the Exceptions accordion is collapsed
    Then the Exceptions accordion header reads "Exceptions (2)"

  Scenario: Each exception shows type, message, and timing
    Given the Exceptions accordion is open
    Then each exception shows an error icon
    And the exception type name is displayed
    And the exception message is displayed
    And a timing offset from the trace start is shown

  Scenario: Exception has a red left border
    Given the Exceptions accordion is open
    Then each exception entry has a red left border

  Scenario: Stack trace is shown in a collapsible monospace block
    Given an exception has a stack trace
    Then the stack trace renders in a collapsible monospace block

  Scenario: Exceptions are sorted by timestamp ascending
    Given the trace has exceptions at +0.5s and +1.2s
    Then the exception at +0.5s appears before the exception at +1.2s

  Scenario: Exception shows span origin link
    Given an exception originated from a span named "llm.openai.chat"
    And the Exceptions accordion is open
    Then a muted line reads "from llm.openai.chat" with a truncated span ID

  Scenario: Clicking span origin link opens that span tab
    Given an exception has a span origin link
    When the user clicks the span name in the origin link
    Then that span's tab opens

  Scenario: Hovering span origin link highlights the span in the visualization
    Given an exception has a span origin link
    When the user hovers over the span origin link
    Then the corresponding span in the visualization above is highlighted


# ─────────────────────────────────────────────────────────────────────────────
# EVENTS SECTION
# ─────────────────────────────────────────────────────────────────────────────

Feature: Trace events accordion
  Shows informational events hoisted from all spans within the trace.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace is selected in the drawer
    And the Events accordion is open

  Scenario: Each event shows icon, name, and timing offset
    Given the trace has events
    Then each event shows an info icon
    And the event name is displayed
    And a timing offset from the trace start is shown

  Scenario: Events are sorted by timestamp ascending
    Given the trace has events at +0.1s, +1.2s, and +2.0s
    Then the events appear in chronological order

  Scenario: Event shows span origin link
    Given an event originated from a span named "tool.search_db"
    Then a muted line reads "from tool.search_db" with a truncated span ID

  Scenario: Clicking event span origin link opens that span tab
    Given an event has a span origin link
    When the user clicks the span name in the origin link
    Then that span's tab opens

  Scenario: Hovering event span origin link highlights the span in the visualization
    Given an event has a span origin link
    When the user hovers over the span origin link
    Then the corresponding span in the visualization above is highlighted

  Scenario: Event attributes render as collapsible key-value block
    Given an event has attributes
    Then the event attributes render in a collapsible key-value block
    And a Flat/JSON toggle is available for the attributes

  Scenario: User feedback renders as an event
    Given the trace has a user feedback event with thumbs up
    Then the event shows a thumbs-up icon
    And the event name reads "user.feedback"

  Scenario: No events shows empty message
    Given the trace has no events
    Then the Events section shows "No events recorded"


# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Feature: Trace summary data gating
  Empty or missing data is handled gracefully with appropriate messaging.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace is selected in the drawer

  Scenario: No input or output shows muted placeholder
    Given the trace has no input and no output
    Then the I/O accordion shows "No input/output captured" in muted text
    And the I/O accordion is auto-closed

  Scenario: No attributes shows muted placeholder
    Given the trace has no attributes
    Then the Attributes accordion shows "No attributes recorded"
    And the Attributes accordion is auto-closed

  Scenario: No exceptions hides the section entirely
    Given the trace has no exceptions
    Then the Exceptions accordion is not shown at all

  Scenario: No events shows muted placeholder
    Given the trace has no events
    Then the Events accordion shows "No events recorded"
    And the Events accordion is auto-closed

  Scenario: Estimated cost shows approximate prefix with tooltip
    Given the trace cost is estimated
    Then the cost displays with a "~" prefix
    And hovering the cost shows a tooltip explaining it is estimated


# ─────────────────────────────────────────────────────────────────────────────
# STATE PERSISTENCE
# ─────────────────────────────────────────────────────────────────────────────

Feature: Trace summary accordion state persistence
  Accordion open/close state is preserved across tab switches within a drawer session.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace is selected in the drawer

  Scenario: Accordion state persists across tab switches
    Given the user manually opened the Events accordion
    And the user manually closed the I/O accordion
    When the user switches to a span tab
    And the user switches back to the Trace Summary tab
    Then the Events accordion is still open
    And the I/O accordion is still closed

  Scenario: Opening a different trace resets accordion state
    Given the user manually opened the Events accordion on the current trace
    When the user selects a different trace
    Then the accordion state resets to auto-open defaults for the new trace
