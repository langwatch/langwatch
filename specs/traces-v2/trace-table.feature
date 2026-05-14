# Trace Table — Gherkin Spec
# Implementation: langwatch/src/features/traces-v2/components/TraceTable/**
#                 langwatch/src/features/traces-v2/components/TracesPage/TracesPage.tsx
#                 langwatch/src/features/traces-v2/stores/{filterStore,viewStore,selectionStore}.ts
#                 langwatch/src/features/traces-v2/hooks/useTraceListQuery.ts
# Audited 2026-05-01: scenarios that described unimplemented behaviour have
# been deleted or tagged @planned. The big movers were
#   - default columns / column ordering (now sourced from viewStore.builtInLenses)
#   - origin facet behaviour (origin is a regular facet; sim/eval don't reveal
#     extra sections — those facets are always rendered)
#   - real-time updates (SSE-driven via useTraceFreshness, NOT 30s polling
#     with a "↑ N new traces" banner)
#   - row format (single-line; the LLM I/O sub-row was the original All-Traces
#     vision but hasn't been implemented as a sub-row in the live grid).

# ─────────────────────────────────────────────────────────────────────────────
# PAGE LAYOUT
# ─────────────────────────────────────────────────────────────────────────────

Feature: Trace table

Rule: Trace table page layout
  The trace table sits in the center column between the filter sidebar
  and the trace drawer.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Three-panel layout renders on Observe page
    When the Observe page loads
    Then the filter sidebar is on the left
    And the trace table fills the center column
    And the trace drawer area is on the right (hidden until a trace is selected)

  Scenario: Filter sidebar expanded state
    When the filter sidebar is expanded
    Then it is 220px wide
    And full facet sections with three-stage checkboxes are visible
    And a collapse button "«" is in the top-right of the sidebar

  Scenario: Filter sidebar collapsed state
    When the user clicks the collapse button "«"
    Then the sidebar collapses to 40px wide
    And section abbreviations with colored active-filter dots are visible
    And an expand button "»" appears
    And clicking any abbreviation expands the sidebar

  # Not yet implemented as of 2026-05-01 — collapsed sidebar today shows
  # facet abbreviations with active dots; there is no separate horizontal
  # chip bar above the table.
  @planned
  Scenario: Filter chip bar when sidebar collapsed with active filters
    Given the filter sidebar is collapsed
    And filters are active
    Then a horizontal chip bar appears between the toolbar and the table


# ─────────────────────────────────────────────────────────────────────────────
# ORIGIN FILTER
# ─────────────────────────────────────────────────────────────────────────────

Rule: Origin filter in sidebar
  Origin is the first facet in the filter sidebar, not a separate control.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: Origin facet is first in the sidebar
    When the filter sidebar renders
    Then the Origin section appears above all other facet sections
    And it has slightly more visual emphasis than other facets

  Scenario: Origin facet shows three values with counts
    When the filter sidebar renders
    Then the Origin section shows "Application", "Simulation", and "Evaluation"
    And each value has a count badge

  Scenario: No origin selected by default
    When the Observe page loads
    Then no origin checkbox is checked
    And traces from all origins are shown

  Scenario: Selecting an origin filters traces and syncs with search bar
    When the user checks "Application" in the Origin facet
    Then only Application traces are shown in the table
    And the search bar shows "@origin:application"

  Scenario: Multi-select origins
    When the user checks "Application" and "Simulation"
    Then traces from both origins are shown
    And the search bar shows "@origin:application @origin:simulation"

  # The following three scenarios describe origin-conditional facet sections
  # (Scenario / Verdict / Eval Type / Score Range) that are not implemented
  # — the sidebar always renders the same facet sections regardless of which
  # origin is checked.
  @planned
  Scenario: Simulation origin reveals additional facets
    When the user checks "Simulation"
    Then additional facets appear below the standard ones: Scenario, Verdict
    And standard facets remain visible

  @planned
  Scenario: Evaluation origin reveals additional facets
    When the user checks "Evaluation"
    Then additional facets appear below the standard ones: Eval Type, Score Range
    And standard facets remain visible

  @planned
  Scenario: Application origin shows standard facets only
    When the user checks "Application"
    Then no additional facets appear beyond the standard ones


# ─────────────────────────────────────────────────────────────────────────────
# TOOLBAR STRIP
# ─────────────────────────────────────────────────────────────────────────────

Rule: Toolbar strip
  A single horizontal strip below the search bar with all table-level controls.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the Observe page is loaded

  Scenario: Toolbar renders the expected controls
    Then the toolbar shows lens tabs flushed left
    And the right cluster includes (in order): tour button, live indicator, time range picker, columns dropdown, grouping selector, density toggle, find button, keyboard shortcuts button
    And the toolbar row is 36px minimum height

  Scenario: Lens tabs take remaining horizontal space
    Then the lens tabs flex to fill remaining space before the right cluster

  Scenario: Grouping selector shows checkmark on selected item
    When the user opens the grouping dropdown
    Then the selected grouping has a checkmark (not a radio circle)

  Scenario: Time range picker shows relative presets and absolute dates
    When the user opens the time range picker
    Then relative presets are available (Last 15m, Last 1h, Last 24h, etc.)
    And absolute date/time selection is available
    And the current timezone is displayed
    And a copy button is available

  # Not yet implemented as of 2026-05-01 — there is no "+ sim" button in the
  # current Toolbar.
  @planned
  Scenario: "+ sim" button is de-emphasized
    Then the "+ sim" button is positioned far right
    And it has de-emphasized styling


# ─────────────────────────────────────────────────────────────────────────────
# LENS TABS — ALL TRACES
# ─────────────────────────────────────────────────────────────────────────────

Rule: All Traces lens (default)
  The default view showing a flat list of all traces.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces

  Scenario: All Traces is the default lens
    When the Observe page loads
    Then the "All" tab is active
    And traces are shown in a flat list with no grouping

  Scenario: Default sort is by time descending
    When the All Traces lens is active
    Then `viewStore.sort` is `{ columnId: "time", direction: "desc" }`

  Scenario: All-traces default columns
    When the All Traces lens is active
    Then the visible columns are: Time, Trace, Service, Duration, Cost, Tokens, Spans, Model, Evals, Events
    And the lens addons include "io-preview" and "expanded-peek"

  Scenario: No filters are locked
    When the All Traces lens is active
    Then the full filter column is available with no locked sections


# ─────────────────────────────────────────────────────────────────────────────
# LENS TABS — CONVERSATIONS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Conversations lens
  Traces grouped by conversation ID showing aggregate data per conversation.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces with conversation IDs

  Scenario: Switching to Conversations groups traces by conversation ID
    When the user clicks the "Conversations" tab
    Then traces are grouped by conversation ID
    And each group appears as a collapsed conversation row

  # Not yet implemented as of 2026-05-01 — Conversations lens does not lock
  # conversation-related facet sections in the sidebar.
  @planned
  Scenario: Conversation-related filters are locked
    When the Conversations lens is active
    Then conversation-related filter sections show a lock icon
    And the section heading shows "set by Conversations"
    And the locked section cannot be expanded
    And hovering the heading shows "This filter is set by the Conversations view. Switch to All Traces to change it."

  Scenario: Conversations sorted by most recent activity
    When the Conversations lens is active
    Then conversations are sorted by most recent message timestamp descending

  Scenario: Traces without conversation ID are excluded
    Given some traces have no conversation ID
    When the Conversations lens is active
    Then those traces do not appear in the list

  Scenario: Collapsed conversation row shows summary data
    When a conversation row is collapsed
    Then line 1 shows: expand toggle, conversation ID (truncated to 8 chars), relative time, last message snippet (~40 chars), turn count, duration, cost, status
    And line 2 shows: message counts (user, assistant, tool), primary model, service name, wall-clock duration

  Scenario: Conversation ID is copyable
    When the user clicks the conversation ID in a row
    Then the full conversation ID is copied to clipboard
    And hovering the ID shows the full ID

  Scenario: Conversation status shows worst status across traces
    Given a conversation has 5 OK traces and 1 errored trace
    Then the conversation row shows Error status

  Scenario: Wall-clock duration shows elapsed real time
    Given a conversation started at 10:00 and the last trace ended at 10:08:12
    Then the wall-clock duration shows "wall: 8m 12s"

  Scenario: Expanding a conversation shows turn rows
    When the user clicks the expand toggle on a conversation
    Then up to 5 turn rows appear below the conversation header
    And each turn shows: turn number, user message, assistant message, tool calls (if any), duration, time-between turns

  Scenario: Long pauses between turns are highlighted
    Given two turns are separated by more than 30 seconds
    Then the time-between shows a highlight like "⏱ +12.4s ← long pause"

  Scenario: More than 5 turns shows overflow
    Given a conversation has 8 turns
    When the conversation is expanded
    Then 5 turns are shown
    And "... 3 more turns" with a "Show all" link appears

  Scenario: Clicking a turn row opens the trace drawer
    When the user clicks a turn row
    Then the trace drawer opens in Trace mode for that specific trace
    And the Conversation toggle is visible in the drawer

  Scenario: Clicking the conversation header row opens drawer in Conversation mode
    When the user clicks the conversation header row (not a turn)
    Then the trace drawer opens in Conversation mode

  Scenario: Conversation columns differ from All Traces
    When the Conversations lens is active
    Then the visible columns are: Conversation (320px min), Turns, Duration, Cost, Tokens, Model, Service, Status

  Scenario: Empty state when no conversations exist
    Given no traces have conversation IDs in the current time range
    When the Conversations lens is active
    Then the table shows "No conversations found."
    And a description explains that traces need a conversation ID


# ─────────────────────────────────────────────────────────────────────────────
# LENS TABS — ERRORS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Errors lens
  Shows only traces with error status, with error detail sub-rows.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces including some with errors

  Scenario: Switching to Errors shows only error traces
    When the user clicks the "Errors" tab
    Then the lens injects `status:error` into the query text
    And only traces with error status are shown

  # Not yet implemented as of 2026-05-01 — the Errors lens injects its filter
  # via queryText, not by locking a sidebar facet section.
  @planned
  Scenario: Status filter is locked in Errors lens
    When the Errors lens is active
    Then the Status facet section is collapsed and locked
    And the section heading shows "Status: Error (set by Errors view)"
    And hovering shows "This filter is set by the Errors view. Switch to All Traces to change it."

  Scenario: Error rows use two-line format
    When the Errors lens is active
    Then each row has two lines
    And line 1 shows: red dot, time, root span name, service, duration, cost, model
    And line 2 shows: erroring span name and exception type + message (truncated, monospace)

  Scenario: Erroring span on root shows "(root)"
    Given a trace where the root span itself errored
    Then line 2 shows "(root)" as the span name

  Scenario: Clicking an error row opens drawer with erroring span pre-selected
    When the user clicks an error row
    Then the trace drawer opens
    And the erroring span is pre-selected in the waterfall

  Scenario: Errors sorted by timestamp descending
    When the Errors lens is active
    Then error traces are sorted by timestamp descending

  Scenario: Empty state when no errors exist
    Given no traces have error status in the current time range
    When the Errors lens is active
    Then the table shows "No errors in the selected time range"


# ─────────────────────────────────────────────────────────────────────────────
# COLUMNS — DEFAULT SET & STATUS INDICATOR
# ─────────────────────────────────────────────────────────────────────────────

Rule: Default columns and status indicator
  The table has a fixed set of default columns plus a status indicator
  rendered as a left border, not a column.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the Observe page is loaded with traces

  Scenario: Default columns are displayed
    Then the table shows columns from the all-traces lens with these widths:
      | id       | size | minSize |
      | time     | 60   | 60      |
      | trace    | 560  | 320     |
      | service  | 160  | 110     |
      | duration | 80   | 70      |
      | cost     | 80   | 70      |
      | tokens   | 65   | 55      |
      | spans    | 60   | 50      |
      | model    | 180  | 140     |

  Scenario: Time column shows relative time with absolute on hover
    Given a trace occurred 2 minutes ago
    Then the Time column shows "2m"
    And hovering shows the absolute timestamp

  Scenario: Time column is sticky during horizontal scroll
    When the table scrolls horizontally
    Then the Time column stays frozen at the left edge

  Scenario: Table header row is sticky during vertical scroll
    When the table scrolls vertically
    Then the header row stays fixed at the top

  Scenario: Table scrolls horizontally when columns exceed viewport
    Given many columns are enabled
    When total column width exceeds the container
    Then horizontal scrolling is available

  Scenario: Duration column shows inline proportional bar
    Then each duration cell shows the formatted duration ("1.2s", "340ms")
    And a subtle proportional bar is rendered inline

  Scenario: Cost column shows appropriate precision
    Then cost values show "$0.003" or "$1.24" with appropriate decimal places

  Scenario: Tokens column shows compact format
    Then token counts show compact format like "1.2K" or "450"

  Scenario: Model column shows abbreviated provider/model
    Given a trace used "gpt-4o"
    Then the Model column shows "oai/4o"

  Scenario: Model column shows badge for multiple models
    Given a trace used "gpt-4o" and "claude-sonnet"
    Then the Model column shows the primary model plus a "+1" badge

  Scenario: OK status has no visual indicator
    Given a trace with OK status
    Then the row has no left border
    And no background tint

  Scenario: Warning status shows yellow border and tint
    Given a trace with warning status
    Then the row has a 2px yellow left border
    And a very subtle yellow background tint

  Scenario: Error status shows red border and tint
    Given a trace with error status
    Then the row has a 2px red left border
    And a very subtle red background tint

  Scenario: Status tint composes with hover state
    Given a trace with error status
    When the user hovers the row
    Then both the hover highlight and the red tint are visible simultaneously

  Scenario: Estimated cost shows tilde prefix
    Given a trace with TokensEstimated = true
    Then the cost shows "~$0.003" with a tilde prefix
    And hovering shows a tooltip "Estimated"


# ─────────────────────────────────────────────────────────────────────────────
# ROW FORMAT — TWO-ZONE ROWS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Two-zone row format (compact density only)
  When the all-traces / errors lens is active and density is "compact",
  the IOPreviewAddon renders an extra row below the header showing the
  trace's input + output preview.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the Observe page is loaded
    And density is "compact"

  Scenario: LLM trace row renders the IOPreviewAddon below the header
    Given a trace has both `input` and `output` populated
    And the row is not expanded
    Then a sub-row is rendered with `colSpan` matching the column count
    And the sub-row body is the IOPreview component
    And the sub-row inherits the row's status border colour on the left edge

  Scenario: Non-LLM trace row shows header only
    Given a trace is missing either `input` or `output`
    Then no IOPreview sub-row is rendered

  Scenario: Comfortable density disables the I/O sub-row
    Given density is "comfortable"
    Then no IOPreview sub-row is rendered for any row

  Scenario: Chat messages I/O shows user and assistant with role icons
    Given a trace I/O is a chat messages array with role and content
    Then the I/O shows the last user message as "↑" with a user icon
    And the assistant response as "↓" with an assistant icon

  Scenario: Tool call I/O shows function name
    Given a trace I/O has a last message with tool_calls
    Then the I/O shows "↓ 🔧 [function_name](args...)"

  Scenario: Plain text I/O shows input and output
    Given a trace I/O is plain text (not chat messages)
    Then the I/O shows '↑ "input text..."' and '↓ "output text..."' with no role icons

  Scenario: JSON I/O shows truncated object
    Given a trace I/O is JSON (non-chat)
    Then the I/O shows "↑ {key: value...}" truncated

  Scenario: I/O snippets are truncated to available width
    Given a trace has long I/O content
    Then snippets are truncated with "..."
    And full text is visible on hover tooltip

  Scenario: LLM detection uses ComputedInput/Output or span attributes
    Given a trace has ComputedInput and ComputedOutput in trace summaries
    Then it renders as an LLM trace with I/O sub-rows

    Given a trace root span has gen_ai.input.messages in attributes
    Then it also renders as an LLM trace with I/O sub-rows

  Scenario: Two-zone hover treats both lines as one unit
    Given a trace has I/O sub-rows
    When the user hovers over the I/O sub-row
    Then both the header line and the I/O lines are highlighted together


# ─────────────────────────────────────────────────────────────────────────────
# COLUMN VISIBILITY & REORDER
# ─────────────────────────────────────────────────────────────────────────────

Rule: Column visibility and reorder
  Users can show/hide columns and drag to reorder them.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the Observe page is loaded

  Scenario: Columns dropdown shows organized sections
    When the user clicks the "Columns" button in the toolbar
    Then a dropdown appears with sections: Standard, Evaluations, Events
    And each column has a visibility checkbox

  Scenario: Standard columns are always available
    When the columns dropdown is open
    # Source: traceColumnDefs in components/TraceTable/columns.ts
    Then the Standard section lists every id in `allTraceColumnIds`:
      time, trace, service, duration, cost, tokens, spans, model,
      evaluations, events, status, ttft, userId, conversationId,
      origin, tokensIn, tokensOut

  Scenario: Evaluations section is dynamic
    Given the project has evaluations for Faithfulness and Toxicity
    When the columns dropdown is open
    Then the Evaluations section shows "Evals (summary badges)", "Faithfulness", and "Toxicity"

  Scenario: Toggling a column checkbox shows or hides the column
    Given the Service column is hidden
    When the user checks "Service" in the dropdown
    Then the Service column appears in the table

  Scenario: Drag-to-reorder columns
    When the user drags a column via its drag handle in the dropdown
    Then a blue top-border indicator shows the drop target
    And releasing reorders the column in the table

  Scenario: Time column cannot be resized
    Then the Time column has `enableResizing: false`
    And dragging its resize grip is a no-op

  Scenario: Column preferences persist
    When the user hides the Tokens column
    And refreshes the page
    Then the Tokens column is still hidden


# ─────────────────────────────────────────────────────────────────────────────
# EVAL & EVENT COLUMNS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Evaluation and event column display
  Eval columns show scores with colored indicators. Event columns show
  counts with exception flags.

  Background:
    Given the user is authenticated with "traces:view" permission
    And eval columns are enabled

  Scenario: Individual eval column shows numeric score with colored dot
    Given a trace has a Faithfulness score of 8.2
    Then the Faithfulness column shows "● 8.2" with a green dot

  Scenario: Individual eval column shows pass/fail
    Given a trace has a Toxicity eval that passed
    Then the Toxicity column shows "● ✓" with a green dot

  Scenario: Eval score coloring thresholds
    Given a score above 7
    Then the dot is green
    Given a score between 4 and 7
    Then the dot is yellow
    Given a score below 4
    Then the dot is red

  Scenario: No eval for a trace shows dash
    Given a trace has no Faithfulness eval
    Then the Faithfulness column shows "—"

  # Not yet implemented as of 2026-05-01 — `makeEvalColumnDef` sets
  # `enableSorting: false`. The backend SORT_COLUMN_MAP doesn't cover eval
  # columns either, so the UI suppresses the header click affordance.
  @planned
  Scenario: Eval column is sortable
    When the user clicks the Faithfulness column header
    Then traces are sorted by Faithfulness score

  Scenario: Clicking an eval score shows detail popover
    When the user clicks a score in an eval column
    Then a popover shows: score, status, reasoning, and timestamp of when the eval ran

  Scenario: Summary badges column shows compact inline badges
    Given the "Evals (summary badges)" column is enabled
    Then each row shows up to 2-3 badges like "● Faith 8.2  ● Toxic ✓"
    And overflow shows "+N" with a hover tooltip listing remaining evals

  Scenario: Summary badges exclude evals with their own column
    Given "Faithfulness" has its own column enabled
    And "Evals (summary badges)" is also enabled
    Then the summary badges column does not include Faithfulness

  Scenario: Events column shows count and exception indicator
    Given the Events column is enabled
    And a trace has 3 events including an exception
    Then the Events column shows "3 ⚠"

  Scenario: Events column shows feedback icon
    Given a trace has events including a thumbs-up feedback event
    Then the Events column shows "3 👍"

  Scenario: Clicking events column opens drawer with Events accordion
    When the user clicks the events count for a trace
    Then the trace drawer opens with the Events accordion expanded


# ─────────────────────────────────────────────────────────────────────────────
# ROW BEHAVIOR
# ─────────────────────────────────────────────────────────────────────────────

Rule: Row click and selection behavior
  Clicking a row opens the trace drawer. Keyboard navigation is supported.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the Observe page is loaded with traces

  Scenario: Clicking a row opens the trace drawer
    When the user clicks a trace row
    Then the trace drawer opens showing that trace's details

  Scenario: Clicking the same trace again closes the drawer (toggle)
    Given the drawer is open for trace "abc123"
    When the user clicks the same trace row
    Then the drawer closes

  Scenario: Clicking a different trace updates the drawer
    Given the drawer is open for trace "abc123"
    When the user clicks trace "def456"
    Then the drawer updates to show "def456"

  Scenario: Selected row shows visual indicator
    When a trace row is selected
    Then it has a left border accent and a subtle background tint

  Scenario: Keyboard navigation with arrow keys
    Given the table body is focused
    When the user presses the Down arrow key
    Then `focusedIndex` advances by one (clamped to the last row)

    When the user presses the Up arrow key
    Then `focusedIndex` decreases by one (clamped to 0)

  Scenario: Enter key toggles the drawer for the focused row
    Given a row is focused via keyboard navigation
    When the user presses Enter
    Then `useTraceLensKeyboard.toggleTrace` runs for that row
    And the drawer opens (or closes, if it was already open for this trace)

  Scenario: Escape closes the drawer
    Given the drawer is open
    When the user presses Escape while the table is focused
    Then `closeDrawer()` is invoked

  Scenario: "p" toggles the inline peek for the focused row
    Given a row is focused via keyboard navigation
    When the user presses "p"
    Then the focused row's `expandedTraceId` toggles


# ─────────────────────────────────────────────────────────────────────────────
# DENSITY TOGGLE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Density toggle
  Users switch between compact and comfortable row density.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the Observe page is loaded

  Scenario: Compact density uses tight spacing
    When the user selects "compact" density
    Then rows are approximately 32px tall
    And font size is 12px
    And padding is tight

  Scenario: Comfortable density uses generous spacing
    When the user selects "comfortable" density
    Then rows are approximately 44px tall
    And font size is 14px
    And padding is generous

  Scenario: Density preference persists across sessions
    When the user selects "compact" density
    And refreshes the page
    Then "compact" density is still active


# ─────────────────────────────────────────────────────────────────────────────
# PAGINATION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Pagination
  The trace table uses explicit pagination, not infinite scroll.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has 583 traces

  Scenario: Default page size is 50
    When the Observe page loads
    Then `filterStore.pageSize` is 50
    And pagination shows "Page 1 of 12 (583 traces)"

  Scenario: Page size selector exposes the supported sizes
    Then the pagination row exposes page-size buttons for 25, 50, 100, 250, 500, 1000
    And the active size is rendered semibold

  Scenario: Next page navigates forward
    Given the user is on page 1
    When the user clicks the next page arrow
    Then page 2 loads with the next 50 traces

  Scenario: Previous page navigates backward
    Given the user is on page 2
    When the user clicks the previous page arrow
    Then page 1 loads

  Scenario: Pagination controls are bottom-right
    Then the pagination controls (previous/next arrows and page indicator) are in the bottom-right of the table


# ─────────────────────────────────────────────────────────────────────────────
# REAL-TIME UPDATES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Real-time trace updates via SSE
  Updates are pushed via the trace-update SSE stream and applied to the
  TanStack Query cache by `useTraceFreshness`. There is no polling loop
  and no "↑ N new traces" inline banner — newly-arrived ids are tracked
  by `useNewlyArrivedTraceIds` and surfaced via the
  `NewTracesScrollUpIndicator` floating control.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the Observe page is loaded

  Scenario: SSE event invalidates the table query
    When a `trace_summary_updated` event arrives via SSE
    Then `useTraceFreshness` invalidates `tracesV2.list` and `tracesV2.newCount`
    And the refresh icon pulses to acknowledge the update

  Scenario: Open drawer is invalidated for affected traces
    Given the drawer is open for trace "abc123"
    When a `trace_summary_updated` event arrives that includes "abc123"
    Then `tracesV2.header`, `tracesV2.spanTree`, and `tracesV2.evals` are invalidated for that trace

  Scenario: Newly-arrived ids surface a scroll-up indicator
    Given the user has scrolled away from the top of the table
    When SSE delivers new traces that land above the current viewport
    Then `NewTracesScrollUpIndicator` becomes visible with the count of unseen traces
    When the user clicks the indicator
    Then the table scrolls back to the top

  # Not yet implemented as of 2026-05-01 — there is no inline banner row at
  # the top of the table; the scroll-up indicator is the only surface.
  @planned
  Scenario: Inline "↑ N new traces" banner with Show action
    Given new traces have arrived
    Then a banner reading "↑ N new traces" with a "Show" button appears at the top of the table

  # Not yet implemented as of 2026-05-01 — the table does not auto-insert
  # rows; the SSE invalidation just refetches the page.
  @planned
  Scenario: Auto-insert when user is not interacting
    Given the user is not hovering or focused on the table
    When new traces arrive
    Then they are auto-inserted at the top


# ─────────────────────────────────────────────────────────────────────────────
# LOADING STATES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Table loading states
  Loading indicators vary by context to avoid jarring transitions.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Initial load shows skeleton rows
    Given no cached data exists
    When the Observe page loads
    Then approximately 10 shimmer skeleton rows are displayed

  Scenario: Preset switch reduces opacity while loading
    Given the All Traces lens is active with data
    When the user switches to the Errors lens
    Then the table remains visible with reduced opacity while re-querying
    And when data arrives the table updates at full opacity

  Scenario: Empty after filter shows message with clear link
    Given filters are active
    And no traces match the current filters
    Then the table shows "No traces match the current filters"
    And a "clear filters" link is available


# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Data gating and null handling
  Different empty/null states are handled with appropriate messages.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Zero traces in project shows onboarding empty state
    Given the project has zero traces
    When the Observe page loads
    Then the onboarding empty state is shown instead of the table

  Scenario: Lens preset has no matching data
    Given the project has traces but none with errors
    When the Errors lens is active
    Then an inline empty state shows within the table area

  Scenario: Null column values show dash
    Given a trace has no service set
    Then the Service column shows "—"

  # Not yet implemented as of 2026-05-01 — `tracesV2.list` returns the same
  # base shape (TraceListItem) regardless of which columns are visible. Eval
  # scores are bundled into the same response via `evaluations`. Toggling a
  # column on does not trigger a separate fetch.
  @planned
  Scenario: Data fetching only queries visible columns
    Given only the default columns are visible
    Then the backend query only fetches fields for visible columns

  @planned
  Scenario: Enabling an optional column triggers data fetch
    Given the Events column was hidden
    When the user enables the Events column
    Then event count data is fetched for the visible traces
