# Visualizations — Gherkin Spec
# Covers: layout, view switching, span selection, hover, color coding, multi-root traces,
#         orphaned spans, 0ms spans, collapsed state, waterfall tree, timeline, time scale,
#         sibling grouping, interactions, performance, data gating

# ─────────────────────────────────────────────────────────────────────────────
# LAYOUT AND VIEW SWITCHING
# ─────────────────────────────────────────────────────────────────────────────

Feature: Visualizations

Rule: Visualization layout and view switching
  The visualization section sits between the header/alerts and the tab bar,
  offering three views of the same span data.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace with multiple spans is open in the trace drawer

  Scenario: Five view tabs are visible
    When the visualization section renders
    Then tab buttons for "Waterfall", "Flame", "Span List", "Topology", and "Sequence" are visible

  Scenario: Waterfall is the default view
    When the trace drawer opens
    Then the Waterfall view is active

  Scenario: Switching views with tab buttons
    When the user clicks the "Flame" tab
    Then the Flame view renders
    And the "Flame" tab is visually active

  Scenario: Switching views with keyboard shortcuts
    When the user presses "1"
    Then the Waterfall view is active
    When the user presses "2"
    Then the Flame view is active
    When the user presses "3"
    Then the Span List view is active
    When the user presses "4"
    Then the Topology view is active
    When the user presses "5"
    Then the Sequence view is active

  Scenario: Selected view persists across drawer reopens
    Given the user switched to the Span List view
    When the user closes and reopens the trace drawer
    Then the Span List view is active

  Scenario: No horizontal scrolling in the visualization container
    When the visualization section renders
    Then the container fills 100% of the drawer content width
    And no horizontal scrollbar appears

  Scenario: Default height mode
    When the visualization section renders
    Then the visualization area is approximately 250px tall

  Scenario: Collapsed height mode
    When the visualization section is at its minimum height
    Then the visualization area is approximately 80px tall

  Scenario: Expanded height mode
    When the user cycles to the expanded height
    Then the visualization area is approximately 480px tall

  Scenario: Minimized height mode
    When the user clicks the cycle-size control while expanded
    Then the visualization area collapses to 0px and only the tab bar is visible

  Scenario: Draggable resize handle between visualization and tab bar
    When the user drags the grip handle below the visualization
    Then the visualization area height changes proportionally up to a 700px maximum
    And the tab bar and accordions below adjust accordingly


# ─────────────────────────────────────────────────────────────────────────────
# SPAN SELECTION (SHARED)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Span selection across all views
  Clicking a span opens the span tab; clicking it again closes the tab.
  Selection state is synchronized across views.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace with multiple spans is open in the trace drawer

  Scenario: Clicking a span opens the span tab
    When the user clicks a span in the visualization
    Then the span tab opens
    And the span detail is displayed

  Scenario: Clicking the same span again closes the span tab in the Waterfall and Span List views
    Given a span is selected and the user is on the Waterfall or Span List view
    When the user clicks the same span again
    Then the span tab closes
    And the Trace Summary is displayed

  Scenario: Selected span is visually highlighted
    When the user clicks a span
    Then the selected span has a brighter border or background
    And all other spans are slightly dimmed

  Scenario: Span selection synchronizes across views
    Given the user selects a span in the Waterfall view
    When the user switches to the Flame view
    Then the same span is highlighted in the Flame view

  Scenario: Selected span can be pinned as a persistent tab
    Given a span is selected and an ephemeral span tab is open
    When the user clicks the pin icon on the span tab
    Then the span tab becomes a pinned tab that survives selecting a different span


# ─────────────────────────────────────────────────────────────────────────────
# HOVER BEHAVIOR (SHARED)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Hover tooltips and cross-highlighting
  Hovering spans shows a tooltip and highlights related elements in
  the Trace Summary tab.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace with multiple spans is open in the trace drawer

  Scenario: Tooltip on span hover in the Waterfall view
    When the user hovers over a span in the Waterfall view
    Then a tooltip displays the span name, duration, offset from trace start, span ID, and (when available) % of trace
    And LLM spans include the model name in the row

  @planned
  # Not yet implemented as of 2026-05-01 — only the Waterfall tooltip exists; tooltips do not include cost, and there is no cross-highlighting between spans and Trace Summary entries.
  Scenario: Tooltip shows cost for spans with cost data
    Given the trace has an LLM span with cost data
    When the user hovers over that LLM span
    Then the tooltip includes the cost

  @planned
  # Not yet implemented as of 2026-05-01
  Scenario: Hovering a span highlights related links in Trace Summary
    Given the Trace Summary tab is visible
    When the user hovers over a span in the visualization
    Then the corresponding span origin links in the Trace Summary events and evals are highlighted

  @planned
  # Not yet implemented as of 2026-05-01
  Scenario: Hovering a span origin link in Trace Summary highlights the span in the visualization
    Given the Trace Summary tab is visible
    When the user hovers over a span origin link in the Trace Summary
    Then the corresponding span in the visualization is highlighted


# ─────────────────────────────────────────────────────────────────────────────
# COLOR CODING BY SPAN TYPE (SHARED)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Color coding by span type
  Every span is color-coded by type, consistent across all three views.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace is open in the trace drawer

  Scenario: LLM spans are blue
    Given the trace contains an LLM span
    Then the LLM span is rendered in blue with a brain icon

  Scenario: Tool spans are green
    Given the trace contains a Tool span
    Then the Tool span is rendered in green with a wrench icon

  Scenario: Agent spans are purple
    Given the trace contains an Agent span
    Then the Agent span is rendered in purple with a bot icon

  Scenario: RAG spans are teal
    Given the trace contains a RAG span
    Then the RAG span is rendered in teal with a database icon

  Scenario: Guardrail spans are orange
    Given the trace contains a Guardrail span
    Then the Guardrail span is rendered in orange with a shield icon

  Scenario: Evaluation spans are pink
    Given the trace contains an Evaluation span
    Then the Evaluation span is rendered in pink with a clipboard-check icon

  Scenario: Chain spans are cyan
    Given the trace contains a Chain span
    Then the Chain span is rendered in cyan with a link icon

  Scenario: Generic spans are gray
    Given the trace contains a Generic span
    Then the Generic span is rendered in gray with a circle icon

  Scenario: Error spans have a red border but keep their type fill color
    Given the trace contains an LLM span with an error status
    Then the span has a red border or outline
    And the span fill color remains blue


# ─────────────────────────────────────────────────────────────────────────────
# MULTI-ROOT TRACES (SHARED)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Multi-root traces
  Traces with two or more root spans are rendered as a forest,
  not forced into a single tree.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace with multiple root spans is open in the trace drawer

  Scenario: Waterfall shows multiple root-level rows
    When the Waterfall view renders
    Then each root span appears at the top level of the tree
    And a subtle separator divides root groups

  Scenario: Flame view shows multiple top-level blocks
    When the Flame view renders
    Then each root span appears as a top-level block

  Scenario: Span List shows all spans regardless of root count
    When the Span List view renders
    Then all spans from all roots appear in the flat table


# ─────────────────────────────────────────────────────────────────────────────
# ORPHANED SPANS (SHARED)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Orphaned spans
  Spans whose parents are not in the trace are shown at root level
  with an indicator, never hidden.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace with orphaned spans is open in the trace drawer

  Scenario: Orphaned spans appear at root level
    When the visualization renders
    Then orphaned spans appear as root-level entries

  Scenario: Orphaned spans show a missing-parent indicator
    When the visualization renders
    Then orphaned spans display a broken-link icon (LuUnlink) on the row
    And the row tooltip shows the "Parent not in trace" warning

  Scenario: Orphaned spans are not hidden even when they are the only spans
    Given a trace contains only orphaned spans
    When the visualization renders
    Then all orphaned spans are visible


# ─────────────────────────────────────────────────────────────────────────────
# ZERO-DURATION SPANS (SHARED)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Zero-duration spans
  Spans with 0ms duration are always visible and clickable,
  never invisible.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace with a 0ms duration span is open in the trace drawer

  Scenario: 0ms span in the Waterfall timeline
    When the Waterfall view renders
    Then the 0ms span appears as a small rotated diamond marker
    And the 0ms span is clickable

  Scenario: 0ms span in the Flame view
    When the Flame view renders
    Then the 0ms span renders at a minimum block width
    And the span details are visible on hover

  Scenario: 0ms span in the Span List
    When the Span List view renders
    Then the duration column for the 0ms span reads "<1ms"


# ─────────────────────────────────────────────────────────────────────────────
# COLLAPSED STATE (SHARED)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Collapsed visualization state
  When collapsed, the visualization shows a compressed overview
  that conveys the trace shape without labels.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace is open in the trace drawer

  Scenario: Collapsed state shows a mini timing-bar overview
    When the visualization section is at its minimum height
    Then a single horizontal track is rendered with a colored mark per span positioned by start time and sized by duration
    And no text labels are displayed except a "Click to expand" hint

  Scenario: Collapsed state reflects errors
    Given the trace contains spans with errors
    When the visualization section is at its minimum height
    Then error spans are filled with red in the compressed overview

  Scenario: Clicking collapsed state expands it
    When the visualization section is at its minimum height
    And the user clicks anywhere on the collapsed overview
    Then the visualization expands to the default height


# ─────────────────────────────────────────────────────────────────────────────
# WATERFALL VIEW: SPAN TREE (LEFT SIDE)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Waterfall span tree
  The left side of the Waterfall view shows a collapsible tree of spans
  with icons, names, durations, and optional LLM metadata.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace with nested spans is open in the trace drawer
    And the Waterfall view is active

  Scenario: Tree structure with expand/collapse arrows
    When the Waterfall view renders
    Then parent spans show a collapse arrow
    And clicking the arrow toggles the children visible or hidden

  Scenario: Span icon matches span type
    When the Waterfall view renders
    Then each span row shows a type-colored icon matching its span type

  Scenario: Span name is displayed in monospace
    When the Waterfall view renders
    Then span names are displayed in a monospace font

  Scenario: Long span names are truncated with tooltip
    Given a span has a name longer than the tree column width
    When the Waterfall view renders
    Then the span name is truncated with ellipsis
    And hovering the span name shows the full name in a tooltip

  Scenario: Span name never completely hidden
    When the tree column is at its minimum width
    Then at least the first 8-10 characters of each span name are visible

  Scenario: Duration is right-aligned before the divider
    When the Waterfall view renders
    Then each span row shows its duration right-aligned in monospace

  Scenario: LLM span shows abbreviated model on a second line
    Given the trace has an LLM span with a model
    When the Waterfall view renders
    Then the LLM span shows a second muted-text line with the abbreviated model name (token count and cost are not shown on this line)

  Scenario: LLM metadata line only appears when a model is set
    Given the trace has an LLM span with no model
    When the Waterfall view renders
    Then no metadata line appears below that LLM span

  Scenario: Error indicator on span row
    Given the trace has a span with error status
    When the Waterfall view renders
    Then the error span row shows a red warning triangle icon (LuTriangleAlert)

  Scenario: Indentation per nesting level
    When the Waterfall view renders
    Then each nesting level is indented approximately 20px deeper

  Scenario: Expand all button expands all parent spans
    When the user clicks the "Expand all" button in the tree header
    Then all collapsible spans in the tree are expanded

  Scenario: Collapse all button collapses all parent spans
    When the user clicks the "Collapse all" button in the tree header
    Then all collapsible spans in the tree are collapsed


# ─────────────────────────────────────────────────────────────────────────────
# WATERFALL VIEW: TIMELINE (RIGHT SIDE)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Waterfall timeline
  The right side of the Waterfall view shows horizontal bars on a time axis,
  positioned by each span's start time and sized by duration.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace with multiple spans is open in the trace drawer
    And the Waterfall view is active

  Scenario: Time axis at top shows trace time range
    When the Waterfall view renders
    Then a time axis at the top shows markers from 0ms to the total trace duration

  Scenario: Bars are positioned by start time and sized by duration
    When the Waterfall view renders
    Then each span bar starts at the span's start time relative to trace start
    And the bar width corresponds to the span duration

  Scenario: Bars are color-coded by span type
    When the Waterfall view renders
    Then each span bar is filled with the color corresponding to its span type
    And bars have slightly rounded corners

  Scenario: Bars align vertically with their span tree rows
    When the Waterfall view renders
    Then each timeline bar is vertically aligned with its corresponding span row on the left

  Scenario: Subtle grid lines at time markers
    When the Waterfall view renders
    Then subtle vertical grid lines appear at the time markers for visual alignment

  Scenario: Tree-timeline divider is resizable
    When the user drags the divider between the tree and timeline
    Then the tree and timeline columns resize proportionally
    And the default split is approximately 38% tree and 62% timeline


# ─────────────────────────────────────────────────────────────────────────────
# WATERFALL VIEW: TIME SCALE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Waterfall time scale
  The time scale adapts to the bimodal distribution of span durations,
  with zoom, pan, and a minimap for navigation.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace is open in the trace drawer
    And the Waterfall view is active

  Scenario: Default linear scale fits the trace duration
    When the Waterfall view renders
    Then the timeline uses a linear scale that fits the full trace duration
    And evenly-spaced time markers are shown across the top

  Scenario: Wheel events on the timeline scroll the tree vertically
    When the user scrolls the wheel over the timeline panel
    Then the scroll is forwarded to the tree's vertical scroll (timeline does not zoom)

  @planned
  # Not yet implemented as of 2026-05-01 — Waterfall has a static linear scale; zoom/pan/minimap/idle-gap compression only exist in the Flame view.
  Scenario: Scroll to zoom in and out on the timeline
    When the user scrolls on the timeline
    Then the timeline zooms in or out

  @planned
  # Not yet implemented as of 2026-05-01
  Scenario: Drag to pan the timeline
    When the user drags on the timeline
    Then the visible portion of the timeline pans

  @planned
  # Not yet implemented as of 2026-05-01
  Scenario: Idle gaps are compressed with a break indicator
    Given the trace has a mix of very short and very long spans with idle gaps
    When the Waterfall view renders
    Then long idle gaps are compressed with a subtle zigzag break indicator
    And short spans remain visible

  @planned
  # Not yet implemented as of 2026-05-01 — no Waterfall minimap exists.
  Scenario: Minimap appears when zoomed in
    When the user zooms into the timeline
    Then a minimap bar appears at the top of the timeline showing the full trace
    And a semi-transparent rectangle indicates the current viewport

  @planned
  # Not yet implemented as of 2026-05-01
  Scenario: Clicking the minimap jumps the viewport
    Given the timeline is zoomed in and the minimap is visible
    When the user clicks a position on the minimap
    Then the viewport jumps to that position

  @planned
  # Not yet implemented as of 2026-05-01
  Scenario: Dragging the minimap viewport pans smoothly
    Given the timeline is zoomed in and the minimap is visible
    When the user drags the viewport rectangle on the minimap
    Then the timeline pans smoothly to follow


# ─────────────────────────────────────────────────────────────────────────────
# WATERFALL VIEW: SIBLING GROUPING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Waterfall sibling grouping
  When a parent has more than five children with the same span name,
  they are collapsed into a summary group row.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the Waterfall view is active

  Scenario: Siblings are grouped when more than five share the same name
    Given a parent span has 10 children all named "Scenario Turn"
    When the Waterfall view renders
    Then the children are collapsed into a single group row

  Scenario: Siblings are not grouped when five or fewer share the same name
    Given a parent span has 4 children all named "tool_call"
    When the Waterfall view renders
    Then each child span appears as its own row

  Scenario: Group row shows count and aggregate stats
    Given a parent span has 77 children all named "Scenario Turn"
    When the Waterfall view renders
    Then the group row shows the span name, count as "×77", average duration, and duration range

  Scenario: Group row shows error count when some siblings have errors
    Given a parent span has 20 children named "step" and 3 of them have errors
    When the Waterfall view renders
    Then the group row includes "3 errors"

  Scenario: Group timeline bar spans the full range of grouped spans
    Given siblings are grouped
    When the Waterfall view renders
    Then the timeline shows a hatched/striped bar spanning from the earliest start to the latest end of the grouped spans

  Scenario: Expanding a group shows all sibling spans
    Given siblings are grouped into a group row
    When the user clicks the expand arrow on the group row
    Then all sibling spans are shown individually

  Scenario: Jump to Span List link pre-filters to grouped siblings
    Given siblings are grouped into a group row
    When the user clicks the "view in Span List" link on the group row
    Then the view switches to Span List
    And the list is pre-filtered to show only those sibling spans


# ─────────────────────────────────────────────────────────────────────────────
# WATERFALL VIEW: INTERACTIONS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Waterfall interactions
  Clickable, hoverable, and draggable elements in the Waterfall view.

  Background:
    Given the user is authenticated with "traces:view" permission
    And a trace with multiple spans is open in the trace drawer
    And the Waterfall view is active

  Scenario: Clicking a span row selects the span
    When the user clicks a span row in the tree
    Then the span is selected and the span tab opens

  Scenario: Clicking a timeline bar selects the span
    When the user clicks a timeline bar
    Then the corresponding span is selected and the span tab opens

  Scenario: Hovering a span row shows a tooltip
    When the user hovers over a span row in the tree
    Then a tooltip with span details appears

  Scenario: Hovering a timeline bar shows a tooltip
    When the user hovers over a timeline bar
    Then a tooltip with span details appears


# ─────────────────────────────────────────────────────────────────────────────
# WATERFALL VIEW: PERFORMANCE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Waterfall performance
  Rendering strategy adapts to span count, using virtualization
  and auto-collapsing for large traces.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the Waterfall view is active

  Scenario: All trace sizes virtualize rows
    When the Waterfall view renders
    Then visible rows are rendered and off-screen rows are recycled by the virtualizer (overscan ~15)

  Scenario: Sibling auto-grouping always applies above the threshold
    Given any parent span has more than 5 children with the same name
    When the Waterfall view renders
    Then those children collapse into a single group row regardless of total trace size

  @planned
  # Not yet implemented as of 2026-05-01 — no depth-based auto-collapse for large traces; virtualizer is the only size-adaptive strategy.
  Scenario: Large traces auto-collapse deep children
    Given a trace with more than 200 spans
    When the Waterfall view renders
    Then children deeper than 2 levels are auto-collapsed
    And a message indicates "N spans collapsed" with an expand button


# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Data gating for edge cases
  The visualization handles incomplete or minimal data gracefully,
  never hiding information.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the Waterfall view is active

  Scenario: Single-span trace shows one row and bar
    Given a trace with exactly one span
    When the Waterfall view renders
    Then one span row and one timeline bar are visible
    And the visualization section is not hidden

  @planned
  # Not yet implemented as of 2026-05-01 — span data shape always carries start/end timestamps; there is no "no timing data" muted-text branch in TreeRow/TimelineBar.
  Scenario: Span with no timing data shows in tree only
    Given a trace has a span with no timing data
    When the Waterfall view renders
    Then the span appears in the tree without a timeline bar
    And the span shows muted text "no timing data"

  Scenario: 0ms span shows as a diamond marker in the timeline
    Given a trace has a span with 0ms duration
    When the Waterfall view renders
    Then the span appears as a small rotated diamond marker positioned at its start time
    And the marker is clickable

  Scenario: Orphaned spans appear at root level with indicator
    Given a trace has orphaned spans
    When the Waterfall view renders
    Then orphaned spans appear at the root level
    And each orphaned span shows a warning indicator

  Scenario: Multi-root trace shows multiple root entries with separators
    Given a trace has three root spans
    When the Waterfall view renders
    Then three root-level entries appear in the tree
    And subtle separators divide the root groups
