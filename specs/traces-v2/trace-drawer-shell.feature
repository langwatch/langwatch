# Trace Drawer Shell — Gherkin Spec
# Implementation:
#   langwatch/src/features/traces-v2/components/TraceDrawer/**
#   langwatch/src/features/traces-v2/stores/drawerStore.ts
#   langwatch/src/features/traces-v2/hooks/{useDrawerUrlSync,useTraceDrawerShortcuts,useTraceDrawerNavigation}.ts
#   langwatch/src/features/traces-v2/hooks/traceDrawerShortcutTable.ts
#
# Audited 2026-05-01: drift between spec and code was significant.
#   - Drawer tabs are SUMMARY / LLM-OPTIMIZED / PROMPTS (the latter only when
#     the trace touched a managed prompt) plus zero-or-more pinned span tabs
#     and an ephemeral "selected but not pinned" span tab. The spec said
#     "Trace Summary" + at most ONE span tab — wrong.
#   - DrawerTab union: "summary" | "span" | "llm" | "prompts".
#   - VizTab union: "waterfall" | "flame" | "spanlist" | "topology" | "sequence".
#     Number-key shortcuts are 1..5 (was 1..3 in spec).
#   - URL params are namespaced `drawer.X` (e.g. `drawer.traceId`,
#     `drawer.mode`, `drawer.viz`, `drawer.tab`, `drawer.span`,
#     `drawer.t`). Flat `?trace=…` was never the format.
#   - Mode switch shortcuts are T (trace view) and C (conversation view), not
#     a single T toggle.
#   - Header chips strip is real but not "composed from an array of dimension
#     descriptors" — see useTraceHeaderChips.

# ─────────────────────────────────────────────────────────────────────────────
# DRAWER LAYOUT
# ─────────────────────────────────────────────────────────────────────────────

Feature: Trace drawer shell

Rule: Drawer layout
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

  Scenario: Drawer shows shell sections in order
    When the drawer is open in Trace mode
    Then the drawer contains sections in this order: DrawerHeader, ConversationContext (when the trace has a conversationId), Visualisation, SpanTabBar, then either the active TraceAccordions / LlmPanel / PromptsPanel
    And the DrawerHeader shows the trace name, status, metrics, the Mode Switch tabs, and the chip strip
    # ContextualAlerts is not yet a discrete shell section — see the contextual alerts rule below.

  Scenario: Close button is visible with Escape badge
    When the drawer is open
    Then a close button is visible in the top-right corner of the drawer
    And the close button shows an Esc keyboard badge


# ─────────────────────────────────────────────────────────────────────────────
# DRAWER MAXIMISE AND RESTORE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Drawer maximise and restore
  The drawer can expand to full content width, hiding the filters and table.

  Background:
    Given the user is authenticated
    And the drawer is open in overlay mode

  Scenario: Maximise drawer by double-clicking header or edge grip
    When the user double-clicks the drawer header (or the left-edge grip)
    Then `drawerStore.toggleMaximized()` runs
    And `Drawer.Content.maxWidth` becomes `calc(100vw - 10px)`
    And a left-edge w-resize cursor + bouncing affordance signals "drag to restore"

  Scenario: Maximise drawer with the M shortcut
    When the user presses M
    Then `drawerStore.toggleMaximized()` runs

  Scenario: Restore drawer to overlay mode
    Given the drawer is maximised
    When the user double-clicks the edge grip (or presses M again)
    Then `Drawer.Content.maxWidth` returns to "45%"


# ─────────────────────────────────────────────────────────────────────────────
# UNIFIED DRAWER MODEL
# ─────────────────────────────────────────────────────────────────────────────

Rule: Unified drawer model
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

Rule: Drawer tab bar
  The SpanTabBar sits below the visualisation and is the active-tab control
  for `drawerStore.activeTab` (one of "summary" | "llm" | "prompts" | "span").
  Spans can be opened ephemerally (one selected-but-not-pinned span tab) or
  pinned, with a "+N more" overflow menu when more than 4 are pinned.

  Background:
    Given the user is authenticated
    And the drawer is open in Trace mode

  Scenario: Summary tab is always present
    Then the tab bar shows a "Summary" tab labelled with shortcut "O"
    And clicking it sets `activeTab` to "summary"

  Scenario: LLM-Optimized tab is always present
    Then the tab bar shows an "LLM-Optimized" tab labelled with shortcut "L"

  Scenario: Prompts tab is conditional on managed-prompt usage
    Given the trace's `containsPrompt` is true (or `langwatch.prompt_ids` is non-empty)
    Then a "Prompts" tab is shown with shortcut "P" and a count badge

  Scenario: Clicking a span in the visualization selects an ephemeral span tab
    When the user clicks a span in the visualization
    Then `selectSpan(spanId)` runs, setting `selectedSpanId` and `activeTab="span"`
    And an ephemeral span tab is rendered with the span name, type badge, model (when LLM), duration, and a Pin + Close action

  Scenario: Pinning a span tab persists it
    Given an ephemeral span tab is shown for span X
    When the user clicks the Pin action
    Then `pinSpan(X)` runs and X is added to `pinnedSpanIds`
    And the ephemeral tab is replaced by a pinned tab for X (with an Unpin action)

  Scenario: Pinned span tabs overflow into a dropdown after the inline limit
    Given more than 4 spans are pinned
    Then only the first 3 pinned spans render inline
    And the rest collapse into a "+N more" dropdown menu

  Scenario: Closing the ephemeral span tab clears the selection
    Given the ephemeral span tab is shown
    When the user clicks the Close action
    Then `clearSpan()` runs, dropping `selectedSpanId` and switching `activeTab` back to "summary"

  Scenario: Escape clears the active span tab before closing the drawer
    Given a span tab is open
    When the user presses Escape
    Then `clearSpan()` runs (the span tab clears) and the drawer remains open

  Scenario: Persistent sections remain visible during tab switching
    Given the drawer is open
    When `activeTab` changes
    Then the DrawerHeader, ModeSwitch, ConversationContext, Visualisation, and SpanTabBar remain mounted
    And only the panel below the tab bar swaps between LlmPanel / PromptsPanel / TraceAccordions


# ─────────────────────────────────────────────────────────────────────────────
# HEADER CHIP STRIP
# ─────────────────────────────────────────────────────────────────────────────

Rule: Header chip strip
  Trace metadata renders as a strip of pill-shaped chips. The chips are
  produced by `useTraceHeaderChipDefs`, which yields a discriminated
  `TraceHeaderChipData` array (kinds: service, origin, scenario, sdk,
  promptSelected, …). `<TraceHeaderChips>` renders one Chip component per
  array entry.

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

Rule: Mode switch
  An inline tab strip below the chip row toggles between Trace and
  Conversation modes when the trace belongs to a conversation.

  Background:
    Given the user is authenticated
    And the drawer is open
    And the trace belongs to a conversation with 6 turns

  Scenario: Mode tabs use an inline underline indicator
    Then "Trace" and "Conversation" render as text tabs with a 2px underline
    And the active tab paints a `blue.solid` underline; the inactive tab paints transparent
    And the tab text shows a Kbd badge for "T" and "C" respectively

  Scenario: Scenario is not a third tab
    Given the trace has a scenario run
    Then no "Scenario" tab is shown in the ModeSwitch
    And the scenario lives as a chip in the header strip instead

  Scenario: Turn position indicator in Trace mode
    When `viewMode === "trace"` and a `turnLabel` is provided
    Then a "turn N of M" label is visible to the right of the tabs

  Scenario: Conversation tab is disabled for traces without a conversation
    Given the trace does not belong to a conversation
    Then the "Conversation" tab is rendered with `disabled` styling
    And hovering it shows "This trace is not part of a conversation"

  Scenario: Switching to Conversation mode with the C shortcut
    Given the trace belongs to a conversation
    When the user presses C
    Then `setViewMode("conversation")` runs

  Scenario: Switching to Trace mode with the T shortcut
    When the user presses T
    Then `setViewMode("trace")` runs (the shortcut is set-not-toggle)


# ─────────────────────────────────────────────────────────────────────────────
# CONTEXT PEEK
# ─────────────────────────────────────────────────────────────────────────────

Rule: Context peek
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

Rule: Conversation mode layout
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

# Not yet implemented as of 2026-05-01 — `ConversationView` renders chat
# turns (user / assistant) only. There is no "system activity (N spans)"
# collapsed group inside individual turns, and there is no per-turn span-tab
# pre-selection.
@planned
Rule: Tool calls within conversation turns
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

Rule: Conversation header
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

Rule: Conversation navigation
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

Rule: Long conversation handling
  ConversationView switches to a TanStack `useVirtualizer` once a
  conversation has more than `VIRTUALIZE_AT = 12` turns. There is no
  "Collapse earlier turns" affordance and no jump-to-turn dropdown.

  Background:
    Given the user is authenticated
    And the drawer is open in Conversation mode

  Scenario: Inline rendering for short conversations
    Given the conversation has 12 or fewer turns
    Then every turn is rendered inline in the scrollable container

  Scenario: Virtualised rendering at the threshold
    Given the conversation has more than 12 turns
    Then ConversationView mounts a `useVirtualizer` keyed on the turn list
    And only the visible window of turns is mounted in the DOM

  # Not yet implemented as of 2026-05-01.
  @planned
  Scenario: Jump-to-turn dropdown shows turn previews
    Given a long conversation
    Then a jump-to-turn dropdown lets the user pick any turn

  @planned
  Scenario: Collapsing earlier turns
    Given a long conversation
    When the user collapses early turns
    Then earlier turns hide behind a summary line

  @planned
  Scenario: Expanding collapsed turns
    Given collapsed earlier turns
    When the user expands them
    Then all turns are visible


# ─────────────────────────────────────────────────────────────────────────────
# CONVERSATION MODE — DETAIL ACCORDIONS
# ─────────────────────────────────────────────────────────────────────────────

# Not yet implemented as of 2026-05-01 — Conversation mode does not show
# accordion sections below the conversation area. The whole rule is tagged
# @planned.
@planned
Rule: Conversation detail accordions
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

Rule: Conversation data gating
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

Rule: Entry points and navigation
  The entry point determines the initial drawer mode.

  Background:
    Given the user is authenticated

  Scenario: Clicking a trace in All Traces opens Trace mode
    When the user clicks a trace in the All Traces preset
    Then the drawer opens in Trace mode

  # Not yet implemented as of 2026-05-01 — `useOpenTraceDrawer` opens the
  # drawer in Trace mode regardless of which lens the click came from. The
  # erroring span is not pre-selected in the SpanTabBar.
  @planned
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
    When the URL contains `drawer.open=traceV2Details&drawer.traceId=…`
    Then the drawer opens in Trace mode for that trace

  # Not yet implemented as of 2026-05-01 — see Deep linking rule below.
  @planned
  Scenario: Deep link to a thread opens Conversation mode
    Given a URL contains only a thread id
    Then the drawer opens directly in Conversation mode

  Scenario: Per-drawer back stack
    Given the drawer is open and the user navigated through several traces
    When the user presses B (or clicks the back arrow in the header)
    Then `popTraceHistory` rewinds to the previous entry in `traceBackStack`


# ─────────────────────────────────────────────────────────────────────────────
# CONTEXTUAL ALERTS
# ─────────────────────────────────────────────────────────────────────────────

# Not yet implemented as of 2026-05-01 — contextual alerts (slow trace
# warnings, prompt-version mismatches, dismissible alert ribbons) have no
# implementation under traces-v2. Errors are surfaced in the Exceptions
# accordion / status border on the row instead. The whole rule below is
# tagged @planned.
@planned
Rule: Contextual alerts
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

Rule: Loading states
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

Rule: Animation and transitions
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

Rule: Keyboard shortcuts
  All drawer keyboard shortcuts are defined in `TRACE_DRAWER_SHORTCUTS` in
  `hooks/traceDrawerShortcutTable.ts` and dispatched by
  `useTraceDrawerShortcuts`. They are ignored when an INPUT/TEXTAREA is
  focused or when the user is holding Ctrl/Cmd/Alt.

  Background:
    Given the user is authenticated
    And the drawer is open

  Scenario: Escape cascade — close shortcuts dialog first
    Given the keyboard shortcuts help dialog is open
    When the user presses Escape
    Then the help dialog closes (the drawer stays open)

  Scenario: Escape cascade — clear span selection second
    Given no help dialog and a span is selected
    When the user presses Escape
    Then `clearSpan()` runs (selectedSpanId clears, activeTab → "summary")

  Scenario: Escape cascade — close drawer last
    Given no help dialog and no selected span
    When the user presses Escape
    Then the drawer closes

  Scenario: Arrow Left / Right navigate traces in the conversation
    Given the trace belongs to a conversation with neighbours
    When the user presses ArrowRight
    Then the drawer navigates to the next conversation trace via `navigateToTrace`
    When the user presses ArrowLeft
    Then the drawer navigates to the previous conversation trace

  Scenario: Bracket keys navigate spans within the trace
    When the user presses ]
    Then `selectSpan` advances by one in `spanTree`
    When the user presses [
    Then `selectSpan` decreases by one in `spanTree`

  Scenario: Number keys switch visualization tabs
    When the user presses 1 / 2 / 3 / 4 / 5
    Then `setVizTab` becomes "waterfall" / "flame" / "spanlist" / "topology" / "sequence" respectively

  Scenario: T sets Trace mode
    When the user presses T
    Then `setViewMode("trace")` runs (it does not toggle)

  Scenario: C switches to Conversation mode
    Given the trace belongs to a conversation
    When the user presses C
    Then `setViewMode("conversation")` runs

  Scenario: O switches to the Summary panel
    When the user presses O
    Then `setActiveTab("summary")` runs

  Scenario: L switches to the LLM-Optimized panel
    When the user presses L
    Then `setViewMode("trace")` then `setActiveTab("llm")` runs

  Scenario: P switches to the Prompts panel when available
    Given the trace touched a managed prompt
    When the user presses P
    Then `setViewMode("trace")` then `setActiveTab("prompts")` runs

  Scenario: M toggles maximize / restore
    When the user presses M
    Then `toggleMaximized()` runs

  Scenario: B navigates back through the per-drawer history stack
    Given `traceBackStack` is non-empty
    When the user presses B
    Then the back-navigation handler pops the stack and opens the previous trace

  Scenario: R refreshes the active trace
    When the user presses R
    Then the scaffold's `refreshActiveTrace` runs

  Scenario: Y copies the trace ID to the clipboard
    When the user presses Y
    Then `navigator.clipboard.writeText(trace.traceId)` runs

  Scenario: ? opens the keyboard shortcuts dialog
    When the user presses ?
    Then `setShortcutsOpen(!current)` runs


# ─────────────────────────────────────────────────────────────────────────────
# DEEP LINKING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Deep linking
  Drawer state is mirrored to the URL via `useDrawerUrlSync`. The URL
  parameters are namespaced under `drawer.X` (the `useDrawer`/Drawer system
  prefixes drawer state with `drawer.`). The drawer key is
  `traceV2Details`, so the activation flag is `drawer.open=traceV2Details`.

  Background:
    Given the user is authenticated

  Scenario: Opening a trace via URL
    When the user navigates to "/observe?drawer.open=traceV2Details&drawer.traceId=abc123"
    Then the drawer opens in Trace mode with the Summary tab active

  Scenario: Opening a trace with the partition-pruning hint
    When the URL also contains `drawer.t=1714476000000`
    Then `drawerStore.occurredAtMs` is hydrated with that timestamp
    And per-trace queries forward it as the partition hint

  Scenario: Opening a trace in conversation mode via URL
    When the URL contains `drawer.mode=conversation`
    Then `viewMode` hydrates to "conversation"

  Scenario: Opening a specific span via URL
    When the URL contains `drawer.span=def456`
    Then `selectedSpanId` is "def456"
    And `activeTab` falls back to "span" if `drawer.tab` is missing

  Scenario: Opening a specific visualization via URL
    When the URL contains `drawer.viz=flame`
    Then `vizTab` is "flame"

  Scenario: Opening a specific drawer panel via URL
    When the URL contains `drawer.tab=llm` (or "summary" / "span" / "prompts")
    Then `activeTab` matches that value

  Scenario: URL updates as drawer state changes
    Given the drawer is open
    When the user changes mode, viz tab, active tab, or selected span
    Then `useDrawerUrlSync` pushes a diff into the URL via `updateDrawerParams`

  # Not yet implemented as of 2026-05-01 — there is no `?thread=` (or
  # `drawer.threadId`) deep link. Conversation mode is opened by passing
  # `drawer.mode=conversation` on a trace inside that conversation.
  @planned
  Scenario: Opening a thread directly via URL
    Given a deep link contains a thread / conversation id
    When the user navigates to that URL
    Then the drawer opens directly in Conversation mode for that thread


# ─────────────────────────────────────────────────────────────────────────────
# RESPONSIVE BEHAVIOR
# ─────────────────────────────────────────────────────────────────────────────

# Not yet implemented as of 2026-05-01 — there are no container queries on
# the drawer; `Drawer.Content` uses a fixed `maxWidth="45%"` (or
# `calc(100vw - 10px)` when maximized). The breakpoints below are
# aspirational.
@planned
Rule: Responsive behavior
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
