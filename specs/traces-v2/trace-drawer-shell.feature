# Trace Drawer Shell — Gherkin Spec
# Based on PRD-004: Trace Drawer Shell
# Covers: drawer layout, overlay/maximise, unified drawer model, span selection tab model,
#         mode switch, context peek, conversation mode, contextual alerts, loading states,
#         animation, navigation, keyboard shortcuts, deep linking, responsive behavior

# ─────────────────────────────────────────────────────────────────────────────
# DRAWER LAYOUT
# ─────────────────────────────────────────────────────────────────────────────

Feature: Drawer layout
  The drawer opens from the right side as an overlay when a trace or session
  is clicked in the table.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Table renders at full width when drawer is closed
    When the Observe page loads
    Then the trace table occupies the full content width beside the filter column
    And no drawer is visible

  Scenario: Drawer overlays the table without resizing it
    When the user clicks a trace in the table
    Then the drawer opens from the right side
    And the table continues to render at full width underneath the drawer
    And the drawer does not push or resize the table

  Scenario: Drawer shows all shell sections in order
    When the drawer is open in Trace mode
    Then the drawer contains sections in this order: Header, Mode Switch, Contextual Alerts, Context Peek, Visualization, Tab Bar, Accordions
    And the Header shows trace name, status, metrics, and tags
    And the Mode Switch is only visible when the trace belongs to a conversation

  Scenario: Close button is visible with Escape badge
    When the drawer is open
    Then a close button is visible in the top-right corner of the drawer
    And the close button shows an Esc keyboard badge


# ─────────────────────────────────────────────────────────────────────────────
# DRAWER MAXIMISE AND RESTORE
# ─────────────────────────────────────────────────────────────────────────────

Feature: Drawer maximise and restore
  The drawer can expand to full content width, hiding the filters and table.

  Background:
    Given the user is authenticated
    And the drawer is open in overlay mode

  Scenario: Maximise drawer by double-clicking header
    When the user double-clicks the drawer header
    Then the drawer expands to full content width
    And the filter column and trace table are hidden
    And a restore button is visible

  Scenario: Maximise drawer by clicking maximise button
    When the user clicks the maximise button
    Then the drawer expands to full content width

  Scenario: Restore drawer to overlay mode
    Given the drawer is maximised
    When the user clicks the restore button
    Then the drawer returns to overlay width
    And the filter column and trace table are visible again


# ─────────────────────────────────────────────────────────────────────────────
# UNIFIED DRAWER MODEL
# ─────────────────────────────────────────────────────────────────────────────

Feature: Unified drawer model
  One drawer shell adapts its content to Trace mode or Conversation mode.

  Background:
    Given the user is authenticated
    And the drawer is open

  Scenario: Trace mode without conversation
    Given the trace does not belong to a conversation
    When the drawer opens in Trace mode
    Then the header shows trace name, metrics, and tags
    And the context area shows the visualization with Waterfall, Flame, and Span List tabs
    And the accordions show Trace Summary with I/O, Attributes, Exceptions, Events, and Evals
    And the Mode Switch toggle is hidden

  Scenario: Trace mode with conversation
    Given the trace belongs to a conversation with 6 turns and this trace is turn 3
    When the drawer opens in Trace mode
    Then the header shows trace name, metrics, and "turn 3/6"
    And the Mode Switch toggle is visible with Trace and Conversation options
    And the context peek is visible above the visualization
    And the visualization and accordions are shown below

  Scenario: Conversation mode
    Given the trace belongs to a conversation
    When the drawer opens in Conversation mode
    Then the header shows the conversation ID and aggregate metrics
    And the context area shows the full conversation with all turns
    And the accordions show conversation summary stats and combined evals

  Scenario: Drawer shell is identical across modes
    When the drawer switches between Trace and Conversation modes
    Then the drawer width, close button, and maximise button remain unchanged


# ─────────────────────────────────────────────────────────────────────────────
# SPAN SELECTION TAB MODEL
# ─────────────────────────────────────────────────────────────────────────────

Feature: Span selection tab model
  Span selection uses a tab bar between the visualization and the accordions.

  Background:
    Given the user is authenticated
    And the drawer is open in Trace mode

  Scenario: Trace Summary tab is always present
    Then the tab bar shows a "Trace Summary" tab
    And the Trace Summary tab cannot be closed
    And it shows trace-level data including I/O, Attributes, Exceptions, Events, and Evals

  Scenario: Clicking a span in the visualization opens a span tab
    When the user clicks a span in the visualization
    Then a span tab appears next to the Trace Summary tab
    And the span tab shows the span name, type badge, key metrics, and a close button
    And the accordion content switches to span-level data with I/O and Attributes

  Scenario: Clicking a different span updates the span tab
    Given a span tab is open for "llm.openai.chat"
    When the user clicks a different span "tool.search_db" in the visualization
    Then the span tab updates to show "tool.search_db"
    And only one span tab exists at a time

  Scenario: Clicking the same span again closes the span tab
    Given a span tab is open for "llm.openai.chat"
    When the user clicks the same span "llm.openai.chat" in the visualization
    Then the span tab closes
    And the Trace Summary tab is active

  Scenario: Closing the span tab with the close button
    Given a span tab is open
    When the user clicks the close button on the span tab
    Then the span tab closes
    And the Trace Summary tab is active

  Scenario: Switching to Trace Summary tab keeps the span tab
    Given a span tab is open for "llm.openai.chat"
    When the user clicks the Trace Summary tab
    Then the accordion content shows trace-level data
    And the span tab remains visible in the tab bar
    And the user can click back to the span tab

  Scenario: Escape closes the span tab
    Given a span tab is open
    When the user presses Escape
    Then the span tab is removed
    And the Trace Summary tab is active

  Scenario: Clicking empty space in the visualization closes the span tab
    Given a span tab is open
    When the user clicks empty space in the visualization
    Then the span tab closes
    And the Trace Summary tab is active

  Scenario: Trace Summary tab content is unaffected by span selection
    Given a span tab is open
    When the user switches between the Trace Summary tab and the span tab
    Then the Trace Summary tab always shows the same trace-level data regardless of which span is selected

  Scenario: Persistent sections remain visible during tab switching
    Given a span tab is open
    When the user switches between tabs
    Then the Header, Mode Switch, Contextual Alerts, Context Peek, and Visualization remain visible
    And only the accordion content below the tab bar changes


# ─────────────────────────────────────────────────────────────────────────────
# HEADER CHIP STRIP
# ─────────────────────────────────────────────────────────────────────────────

Feature: Header chip strip
  Trace metadata renders as a strip of pill-shaped chips above the mode
  switch. The strip is composed from an array — each chip is one entry —
  so adding a new dimension (prompt, scenario, sdk, …) is one entry, not
  a JSX edit in the header.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the drawer is open in Trace mode

  Scenario: Service and origin chips render for every trace
    Then a "Service" chip shows the trace's serviceName
    And an "Origin" chip shows the trace's origin

  Scenario: SDK chip surfaces parsed SDK info
    Given the trace was emitted with sdk.name and sdk.version attributes
    Then an "SDK" chip is visible
    And hovering it shows a tooltip with library, version, language, and family

  Scenario: Scenario chip links out to the scenario run
    Given the trace has a scenario run
    Then a "Scenario" chip is visible with a status dot
    And clicking it opens a popover with the run's status, criteria, and "Open run" link
    And the chip is not a tab — selecting it does not switch the drawer view

  Scenario: Chip strip collapses when many chips are present
    Given the chip strip would otherwise render more than 6 chips
    Then the lowest-priority chips collapse into a "+N more" pill
    And clicking the pill reveals the hidden chips in a popover

  Scenario: End slot renders on the far right of the strip
    Then the trace's relative timestamp renders right-aligned next to the chips


# ─────────────────────────────────────────────────────────────────────────────
# MODE SWITCH
# ─────────────────────────────────────────────────────────────────────────────

Feature: Mode switch
  An inline tab strip below the chip row toggles between Trace and
  Conversation modes when the trace belongs to a conversation.

  Background:
    Given the user is authenticated
    And the drawer is open
    And the trace belongs to a conversation with 6 turns

  Scenario: Mode tabs use an inline underline indicator
    Then "Trace" and "Conversation" render as text tabs with a 2px underline
    And the active tab paints the underline; the inactive tab does not
    And there is no bordered segmented-control box around the tabs

  Scenario: Scenario is not a third tab
    Given the trace has a scenario run
    Then no "Scenario" tab is shown in the mode switch
    And the scenario lives as a chip in the header strip instead

  Scenario: Turn position indicator in Trace mode
    When Trace mode is active
    Then a "turn 3 of 6" label is visible next to the tabs

  Scenario: Conversation tab is disabled for traces without a conversation
    Given the trace does not belong to a conversation
    Then the "Conversation" tab is shown but disabled
    And hovering it shows "This trace is not part of a conversation"

  Scenario: Switching from Trace to Conversation mode
    Given Trace mode is active
    When the user clicks "Conversation"
    Then the content below the tabs fades out and the conversation view fades in

  Scenario: Switching from Conversation to Trace mode
    Given Conversation mode is active
    When the user clicks "Trace"
    Then the content below the tabs fades out and the trace view fades in


# ─────────────────────────────────────────────────────────────────────────────
# CONTEXT PEEK
# ─────────────────────────────────────────────────────────────────────────────

Feature: Context peek
  In Trace mode, when the trace belongs to a conversation, a compact context
  peek shows adjacent turns above the visualization.

  Background:
    Given the user is authenticated
    And the drawer is open in Trace mode
    And the trace belongs to a conversation

  Scenario: Context peek shows three turns
    Then the context peek shows the previous turn, the current turn highlighted, and the next turn
    And each turn is a compact single-line snippet
    And the display is at most 3 lines

  Scenario: Navigating to the previous turn
    When the user clicks the left arrow in the context peek
    Then the drawer updates with a fade animation to show the previous trace

  Scenario: Navigating to the next turn
    When the user clicks the right arrow in the context peek
    Then the drawer updates with a fade animation to show the next trace

  Scenario: Context peek is hidden for traces without a conversation
    Given the trace does not belong to a conversation
    Then the context peek section is not visible

  Scenario: Context peek is hidden in Conversation mode
    Given the drawer is in Conversation mode
    Then the context peek section is not visible


# ─────────────────────────────────────────────────────────────────────────────
# CONVERSATION MODE — LAYOUT AND TURNS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conversation mode layout
  The conversation view shows the user-facing thread with system machinery
  visible but subordinate.

  Background:
    Given the user is authenticated
    And the drawer is open in Conversation mode
    And the conversation has multiple turns

  Scenario: Turns are displayed sequentially
    Then each turn is displayed with a turn number label
    And turns are ordered chronologically

  Scenario: Turn shows user message
    Then each turn displays the user input message
    And long messages are truncated at approximately 300 characters with a "Show full" expander

  Scenario: Turn shows assistant response
    Then each turn displays the assistant output message
    And long responses are truncated at approximately 300 characters with a "Show full" expander

  Scenario: Turn shows metrics line
    Then each turn displays duration, cost, and model name in muted text below the assistant response

  Scenario: Turn shows error indicator for erroring traces
    Given a turn's trace has an error status
    Then a warning indicator appears on the turn header

  Scenario: Turn shows trace link
    Then each turn has a "trace" link right-aligned on the turn header
    When the user clicks the trace link
    Then the drawer switches to Trace mode for that specific trace

  Scenario: Time-between separator is shown between turns
    Then a time-between separator appears between consecutive turns
    And it shows the wall-clock gap as relative time

  Scenario: Long pause is highlighted
    Given the gap between two turns exceeds 30 seconds
    Then the separator shows the time with a "long pause" label
    And the separator has a subtle yellow background

  Scenario: No separator above the first turn
    Then the first turn has no time-between separator above it


# ─────────────────────────────────────────────────────────────────────────────
# CONVERSATION MODE — TOOL CALLS WITHIN TURNS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Tool calls within conversation turns
  Tool calls, guardrails, and RAG spans are shown as collapsed system activity
  within each turn.

  Background:
    Given the user is authenticated
    And the drawer is open in Conversation mode

  Scenario: System activity group is shown when turn has tool, guardrail, or RAG spans
    Given a turn has tool, guardrail, or RAG spans
    Then a "System activity (N spans)" collapsed group appears within the turn
    And each item shows a type icon, name, args summary, and return summary on one line

  Scenario: System activity is collapsed by default
    Given a turn has system activity
    Then the system activity group is collapsed
    When the user expands the group
    Then the individual spans are listed

  Scenario: Clicking a system activity span opens Trace mode
    Given a turn has system activity expanded
    When the user clicks a system activity span
    Then the drawer switches to Trace mode for that turn
    And the clicked span is pre-selected in the span tab

  Scenario: LLM and orchestration spans are hidden from system activity
    Given a turn has LLM spans and agent/chain spans
    Then those spans do not appear in the system activity group

  Scenario: System activity group is hidden when no relevant spans exist
    Given a turn has no tool, guardrail, or RAG spans
    Then the system activity group is not shown


# ─────────────────────────────────────────────────────────────────────────────
# CONVERSATION MODE — HEADER
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conversation header
  The conversation header shows aggregate information about the entire
  conversation.

  Background:
    Given the user is authenticated
    And the drawer is open in Conversation mode

  Scenario: Conversation ID is displayed with copy button
    Then the conversation ID is shown truncated to 8 characters
    And hovering the ID shows the full ID in a tooltip
    And a copy-to-clipboard button is adjacent to the ID

  Scenario: Message counts are displayed
    Then the header shows counts of user messages, assistant messages, and tool calls with icons

  Scenario: Aggregate metrics are displayed
    Then the header shows total duration as the sum of all trace durations
    And total cost as the sum of all trace costs

  Scenario: Time span is displayed
    Then the header shows the first message timestamp, last message timestamp, and wall-clock span


# ─────────────────────────────────────────────────────────────────────────────
# CONVERSATION MODE — NAVIGATION
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conversation navigation
  Navigation within the conversation view uses scrolling, keyboard controls,
  and a jump-to-turn selector.

  Background:
    Given the user is authenticated
    And the drawer is open in Conversation mode
    And the conversation has multiple turns

  Scenario: Conversation area is scrollable
    Then all turns are rendered in a scrollable container
    And turns are not paginated

  Scenario: Clicking a turn number scrolls to that turn
    When the user clicks a turn number label
    Then that turn scrolls into view

  Scenario: Keyboard navigation with arrows
    When the user presses Up or Down arrow keys
    Then the conversation scrolls accordingly

  Scenario: Enter on a turn opens Trace mode
    When a turn is focused and the user presses Enter
    Then the drawer switches to Trace mode for that turn's trace

  Scenario: Current turn is highlighted when entering from a specific trace
    Given the user entered Conversation mode from a specific trace
    Then that turn is highlighted with a subtle left border
    And it is scrolled into view

  Scenario: Jump-to-turn selector for long conversations
    Given the conversation has many turns
    Then a jump-to-turn selector appears in the conversation header


# ─────────────────────────────────────────────────────────────────────────────
# CONVERSATION MODE — LONG CONVERSATIONS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Long conversation handling
  Conversations with 20 or more turns receive additional navigation aids
  and performance optimizations.

  Background:
    Given the user is authenticated
    And the drawer is open in Conversation mode

  Scenario: All turns are rendered without pagination
    Given the conversation has 25 turns
    Then all 25 turns are rendered in the scrollable container

  Scenario: Virtual scrolling for very long conversations
    Given the conversation has 50 or more turns
    Then virtual scrolling is used to keep the DOM manageable

  Scenario: Jump-to-turn dropdown shows turn previews
    Given the conversation has 20 or more turns
    Then the jump-to-turn selector becomes a dropdown
    And each option shows the turn number and the first few words of the user message

  Scenario: Collapsing earlier turns
    Given the conversation has more than 5 turns
    Then a "Collapse earlier turns" control appears after the first 5 turns
    When the user clicks "Collapse earlier turns"
    Then earlier turns collapse into a summary line showing the count of collapsed turns
    And the most recent 5 turns remain visible

  Scenario: Expanding collapsed turns
    Given earlier turns are collapsed
    When the user clicks the collapsed turns summary
    Then all turns expand and become visible


# ─────────────────────────────────────────────────────────────────────────────
# CONVERSATION MODE — DETAIL ACCORDIONS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conversation detail accordions
  Below the conversation area, accordion sections show conversation-level
  aggregated data.

  Background:
    Given the user is authenticated
    And the drawer is open in Conversation mode

  Scenario: Conversation Summary accordion is open by default
    Then the "Conversation Summary" accordion is expanded
    And it shows turn count, compute duration, wall-clock duration, total cost, total tokens, models used, tools used, and error count

  Scenario: Cost per turn chart is shown for multi-turn conversations
    Given the conversation has more than 2 turns and cost data exists
    Then a horizontal bar chart showing cost distribution across turns is visible in the summary

  Scenario: Duration per turn chart is shown for multi-turn conversations
    Given the conversation has more than 2 turns
    Then a horizontal bar chart showing duration per turn is visible in the summary

  Scenario: Charts are hidden for short conversations
    Given the conversation has 2 or fewer turns
    Then the cost per turn and duration per turn charts are not shown

  Scenario: Events accordion shows all events across turns
    When the user expands the "Events" accordion
    Then events from all turns are shown in chronological order
    And each event shows which turn it came from

  Scenario: Evals accordion shows all evaluations across turns
    When the user expands the "Evals" accordion
    Then evaluation results from all turns are listed separately
    And each eval shows which turn it came from
    And evaluations of the same type on different turns are not aggregated


# ─────────────────────────────────────────────────────────────────────────────
# CONVERSATION MODE — DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Feature: Conversation data gating
  Edge cases in conversation data are handled gracefully.

  Background:
    Given the user is authenticated
    And the drawer is open in Conversation mode

  Scenario: Single-turn conversation
    Given the conversation has exactly 1 turn
    Then the single turn is displayed normally with no special handling

  Scenario: Turn with no user message
    Given a turn has no user message
    Then only the assistant message is shown for that turn

  Scenario: Turn with no assistant message
    Given a turn has no assistant message
    Then the user message is shown
    And "No response generated" appears in muted text

  Scenario: Turn with only tool calls
    Given a turn has no user or assistant messages but has tool calls
    Then the turn is shown as a system turn with tool names listed
    And collapsed details are available

  Scenario: Missing trace data for a turn
    Given a trace in the conversation cannot be loaded
    Then the turn shows "Data unavailable" in muted text
    And the turn number is not skipped

  Scenario: Conversation with zero turns loaded
    Given no traces can be loaded for the conversation
    Then the message "No traces found for this conversation." is displayed


# ─────────────────────────────────────────────────────────────────────────────
# ENTRY POINTS AND NAVIGATION
# ─────────────────────────────────────────────────────────────────────────────

Feature: Entry points and navigation
  The entry point determines the initial drawer mode.

  Background:
    Given the user is authenticated

  Scenario: Clicking a trace in All Traces opens Trace mode
    When the user clicks a trace in the All Traces preset
    Then the drawer opens in Trace mode

  Scenario: Clicking a trace in Errors preset opens Trace mode with span pre-selected
    When the user clicks a trace in the Errors preset
    Then the drawer opens in Trace mode
    And the erroring span is pre-selected in the span tab

  Scenario: Clicking a conversation header opens Conversation mode
    When the user clicks a conversation header in the Conversations preset
    Then the drawer opens in Conversation mode

  Scenario: Clicking an individual turn in Conversations preset opens Trace mode
    When the user clicks an individual turn in the Conversations preset
    Then the drawer opens in Trace mode
    And the conversation toggle is visible

  Scenario: Deep link to a trace opens Trace mode
    When the user navigates to a deep link containing a trace ID
    Then the drawer opens in Trace mode for that trace

  Scenario: Deep link to a thread opens Conversation mode
    When the user navigates to a deep link containing a thread ID
    Then the drawer opens in Conversation mode

  Scenario: Back button returns to the originating table view
    Given the drawer is open
    When the user clicks the back button
    Then the drawer closes and the table view the user came from is restored


# ─────────────────────────────────────────────────────────────────────────────
# CONTEXTUAL ALERTS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Contextual alerts
  Rule-based alerts shown below the header in Trace mode only.

  Background:
    Given the user is authenticated
    And the drawer is open in Trace mode

  Scenario: Slow trace alert
    Given the trace duration exceeds 2x the 24-hour p50 for this service
    Then a yellow warning alert reads "This trace is Xx slower than the 24h average"

  Scenario: Error trace alert
    Given the trace has an error status
    Then a red error alert shows the error message

  Scenario: Prompt version mismatch alert
    Given a span used a prompt version that differs from the active version
    Then a yellow warning alert indicates the version mismatch

  Scenario: Alerts are dismissible
    Given an alert is visible
    When the user clicks the dismiss button on the alert
    Then the alert is dismissed

  Scenario: Maximum two alerts are shown
    Given the trace triggers more than 2 alert conditions
    Then only 2 alerts are shown
    And an "and N more" indicator shows the count of additional alerts

  Scenario: Alerts are not shown in Conversation mode
    When the drawer switches to Conversation mode
    Then no contextual alerts are visible


# ─────────────────────────────────────────────────────────────────────────────
# LOADING STATES
# ─────────────────────────────────────────────────────────────────────────────

Feature: Loading states
  Data streams progressively over HTTP/2 and sections render as data arrives.

  Background:
    Given the user is authenticated

  Scenario: Drawer opens immediately before data loads
    When the user clicks a trace
    Then the drawer slides open immediately

  Scenario: Header renders first
    When the drawer is loading
    Then the header renders first with trace name, status, metrics, and tags

  Scenario: Visualization renders incrementally as spans arrive
    When spans begin streaming in
    Then the visualization builds incrementally
    And early spans are interactive before all spans have loaded

  Scenario: Accordion sections show skeleton shimmer until data arrives
    When accordion data has not yet arrived
    Then sections show a skeleton shimmer placeholder
    And content fades in when the data arrives

  Scenario: Trace switch fades content
    Given the drawer is showing a trace
    When the user navigates to a different trace
    Then the old content fades out
    And the new header renders immediately
    And the visualization and accordions stream in progressively

  Scenario: Failed to load trace data
    When the trace data fails to load
    Then the drawer shows "Failed to load trace data" with a Retry button
    And the drawer stays open

  Scenario: Trace no longer exists
    When the trace has been deleted or is not found
    Then the drawer shows "This trace no longer exists" with a Close button

  Scenario: Partial load failure
    When some sections load successfully but one section fails
    Then the loaded sections display their content
    And the failed section shows an error message with a Retry button for that section only


# ─────────────────────────────────────────────────────────────────────────────
# ANIMATION AND TRANSITIONS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Animation and transitions
  All drawer animations are CSS-only and follow consistent patterns.

  Background:
    Given the user is authenticated

  Scenario: Drawer open animation
    When the drawer opens
    Then it fades in from opacity 0 to 1 with a subtle rightward translate over approximately 250ms ease-out

  Scenario: Drawer close animation
    When the drawer closes
    Then it fades out from opacity 1 to 0 with a subtle rightward translate over approximately 200ms ease-in

  Scenario: Maximise and restore animation
    When the drawer maximises or restores
    Then the width transitions over approximately 200ms

  Scenario: Content switch uses fade animation
    When the drawer content switches due to trace switch, mode switch, or tab switch
    Then the content fades out over approximately 100ms
    And the new content fades in over approximately 150ms
    And no scale or bounce effects are used


# ─────────────────────────────────────────────────────────────────────────────
# KEYBOARD SHORTCUTS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Keyboard shortcuts
  Keyboard shortcuts for navigating the drawer follow the Focus Zone Model.

  Background:
    Given the user is authenticated
    And the drawer is open

  Scenario: Escape cascade — close span tab
    Given a span tab is open and the flame graph is not zoomed
    When the user presses Escape
    Then the span tab closes and Trace Summary is active

  Scenario: Escape cascade — close drawer
    Given no span tab is open and the flame graph is not zoomed
    When the user presses Escape
    Then the drawer closes

  Scenario: Escape cascade — zoom out flame graph first
    Given the flame graph is zoomed in
    When the user presses Escape
    Then the flame graph zooms out one level
    And the drawer remains open

  Scenario: J and K navigate traces
    When the user presses J
    Then the drawer updates to show the next trace in the list
    When the user presses K
    Then the drawer updates to show the previous trace in the list

  Scenario: Bracket keys navigate conversation turns
    Given the trace belongs to a conversation
    When the user presses ]
    Then the drawer navigates to the next conversation turn
    When the user presses [
    Then the drawer navigates to the previous conversation turn

  Scenario: Number keys switch visualization tabs
    Given the drawer is in Trace mode
    When the user presses 1
    Then the Waterfall visualization is active
    When the user presses 2
    Then the Flame visualization is active
    When the user presses 3
    Then the Span List visualization is active

  Scenario: T toggles between Trace and Conversation modes
    Given the trace belongs to a conversation
    When the user presses T
    Then the drawer toggles between Trace and Conversation modes

  Scenario: O switches to Trace Summary tab
    Given a span tab is open
    When the user presses O
    Then the Trace Summary tab becomes active


# ─────────────────────────────────────────────────────────────────────────────
# DEEP LINKING
# ─────────────────────────────────────────────────────────────────────────────

Feature: Deep linking
  Drawer state is reflected in the URL so pages can be loaded with the drawer
  pre-configured.

  Background:
    Given the user is authenticated

  Scenario: Opening a trace via URL
    When the user navigates to "/observe?trace=abc123"
    Then the drawer opens in Trace mode with the Trace Summary tab active

  Scenario: Opening a trace in conversation mode via URL
    When the user navigates to "/observe?trace=abc123&mode=conversation"
    Then the drawer opens in Conversation mode

  Scenario: Opening a specific span via URL
    When the user navigates to "/observe?trace=abc123&span=def456"
    Then the drawer opens with the span tab active for span "def456"

  Scenario: Opening a specific visualization via URL
    When the user navigates to "/observe?trace=abc123&viz=waterfall"
    Then the drawer opens with the Waterfall visualization active

  Scenario: Opening a specific accordion tab via URL
    When the user navigates to "/observe?trace=abc123&tab=events"
    Then the drawer opens with the Events accordion expanded

  Scenario: Opening a thread directly via URL
    When the user navigates to "/observe?thread=xyz789"
    Then the drawer opens in Conversation mode for that thread

  Scenario: URL updates as drawer state changes
    Given the drawer is open
    When the user selects a span or changes the visualization
    Then the URL updates to reflect the current drawer state


# ─────────────────────────────────────────────────────────────────────────────
# RESPONSIVE BEHAVIOR
# ─────────────────────────────────────────────────────────────────────────────

Feature: Responsive behavior
  The drawer layout adapts based on container width using Chakra v3 container
  queries, not viewport media queries.

  Background:
    Given the user is authenticated

  Scenario: Full three-column layout at wide containers
    Given the container width is 1400px or more
    When the drawer is open
    Then the filter column, trace table, and drawer are all visible

  Scenario: Filter column auto-collapses at medium-wide containers
    Given the container width is between 1200px and 1399px
    When the drawer opens
    Then the filter column auto-collapses
    And the table and drawer are visible in two columns

  Scenario: Narrower table at medium containers
    Given the container width is between 1024px and 1199px
    When the drawer is open
    Then the table shows fewer columns
    And the filter sidebar is collapsed by default

  Scenario: Full-width drawer at narrow containers
    Given the container width is less than 1024px
    When the drawer opens
    Then the drawer goes full-width
    And the table is hidden
    And a back button returns to the table
    And the filter sidebar is a slide-over overlay
