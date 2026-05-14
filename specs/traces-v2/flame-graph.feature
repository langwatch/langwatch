# Flame Graph — Gherkin Spec
# Covers: block layout, labels, zoom, breadcrumbs, sibling grouping, edge cases, time scale, interactions, keyboard navigation, performance, data gating

# ─────────────────────────────────────────────────────────────────────────────
# BLOCK LAYOUT
# ─────────────────────────────────────────────────────────────────────────────

Feature: Flame graph

Rule: Flame graph block layout
  Stacked blocks where parent spans sit on top and children below, with width proportional to duration.

  Background:
    Given the user is viewing a trace with multiple spans in the trace drawer
    And the Flame Graph tab is selected

  Scenario: Parent spans render above their children
    Then each parent span renders as a block in the row above its children
    And each depth level occupies one row

  Scenario: Block width is proportional to duration on the time axis
    Then each block's horizontal position corresponds to its start time
    And each block's width is proportional to its duration

  Scenario: Blocks are colored by span type
    Then each block is colored according to the shared span type palette

  Scenario: Gaps between siblings show idle time
    Given a parent span has children that do not cover its full duration
    Then visible gaps appear between child blocks where no child was executing

  Scenario: Children stay within parent horizontal bounds
    Then no child block extends beyond the left or right edge of its parent block

  @planned
  # Not yet implemented as of 2026-05-01 — FlameRow renders blocks per depth row but does not draw parent→child connectors.
  Scenario: Connecting lines link parent to children
    Then subtle vertical hairlines connect the bottom of each parent block to the top of its children


# ─────────────────────────────────────────────────────────────────────────────
# BLOCK CONTENT AND LABELS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Flame graph block content
  Each block displays contextual information based on available space.

  Background:
    Given the user is viewing a trace in the flame graph

  Scenario: Block shows span name and duration when wide enough
    Given a block has sufficient width for text
    Then it displays the span name and duration in parentheses

  Scenario: Block truncates label when moderately narrow
    Given a block is too narrow for the full span name
    Then the span name is truncated but still partially visible

  Scenario: Block shows no text when very narrow
    Given a block is too narrow for any text
    Then it renders as a colored block with no label
    And the span name and duration appear in a hover tooltip

  Scenario: LLM span shows model name inline when wide enough
    Given a block represents an LLM span
    And the block has sufficient width
    Then the block label shows the span name, duration in parentheses, and the abbreviated model name appended after a separator

  @planned
  # Not yet implemented as of 2026-05-01 — block fill is the per-type solid color; depth-based shading is not applied.
  Scenario: Depth shading distinguishes nesting levels
    Then deeper blocks render with a slightly lighter or more muted shade than shallower blocks


# ─────────────────────────────────────────────────────────────────────────────
# CLICK-TO-ZOOM
# ─────────────────────────────────────────────────────────────────────────────

Rule: Flame graph click and zoom interactions
  Single-click selects a span (opens the span tab); double-click zooms the viewport to fit that span. Zooming does not collapse the depth tree — it only rescales the time axis.

  Background:
    Given the user is viewing a trace in the flame graph

  Scenario: Clicking a block selects the span and opens the span tab
    When the user clicks a span block
    Then the span is selected
    And the span tab opens with that span's details
    And the focused-span ring is set on the block

  Scenario: Double-clicking a block animates a zoom-to-fit
    When the user double-clicks a span block
    Then the time axis animates to fit that block's start and end (with small padding)
    And the span is also selected and the span tab opens

  Scenario: Breadcrumb of the focused span shows when zoomed
    Given the user has zoomed (or focused a deeply-nested block)
    Then a breadcrumb shows "root → ancestor → … → focused span" above the flame area
    And clicking a breadcrumb segment animates a zoom to that ancestor

  Scenario: Reset button returns to the full trace range
    Given the time axis is zoomed
    Then a "Reset" button is visible in the breadcrumb row
    When the user clicks Reset (or presses Esc / 0 / Home)
    Then the viewport animates back to the full trace range


# ─────────────────────────────────────────────────────────────────────────────
# DRAG-TO-ZOOM
# ─────────────────────────────────────────────────────────────────────────────

Rule: Flame graph drag-to-zoom on the time axis
  Click and drag horizontally on the dedicated time-axis strip to zoom into a specific time range. Dragging on the flame area itself pans the viewport instead of selecting a range.

  Background:
    Given the user is viewing a trace in the flame graph

  Scenario: Dragging horizontally on the time axis shows a selection overlay
    When the user clicks and drags horizontally on the time-axis strip
    Then a semi-transparent blue selection overlay with a duration tooltip highlights the dragged region

  Scenario: Releasing the time-axis drag zooms to the selected range
    When the user completes a horizontal drag on the time axis
    Then the viewport animates to show only the selected time range

  Scenario: Drag-to-zoom works at any zoom level
    Given the user has already zoomed in
    When the user performs a horizontal drag on the time axis
    Then the view zooms further into the selected time range

  Scenario: Dragging on the flame area pans rather than zooming
    When the user drags horizontally on the flame area (below the time axis)
    Then the viewport pans by the drag delta and no selection overlay is drawn


# ─────────────────────────────────────────────────────────────────────────────
# BREADCRUMBS AND ZOOM NAVIGATION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Flame graph breadcrumbs
  Breadcrumbs show the focus span's ancestor chain and let the user jump between zoom levels.

  Background:
    Given the user is viewing a trace in the flame graph
    And a span is focused or selected (so a breadcrumb chain exists)

  Scenario: Breadcrumb shows parent chain of focused block
    Then a breadcrumb row appears above the flame graph starting with "root"
    And subsequent segments show each ancestor up to the focused span, separated by chevron icons

  Scenario: Clicking a breadcrumb segment animates a zoom to that ancestor
    When the user clicks a breadcrumb segment (other than the last)
    Then the view animates a zoom-to-fit on that ancestor block

  Scenario: Reset zoom from breadcrumb row
    Given the time axis is zoomed
    Then a "Reset" button is visible alongside the breadcrumbs
    When the user clicks it
    Then the viewport animates back to the full trace range

  @planned
  # Not yet implemented as of 2026-05-01 — there is no dedicated "zoom out one level" button; users go up via breadcrumbs or Esc/0/Home/Backspace.
  Scenario: Zoom out button goes up one level
    When the user clicks the zoom out button
    Then the view zooms out to the parent of the currently focused block


# ─────────────────────────────────────────────────────────────────────────────
# HOVER INTERACTIONS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Flame graph hover behavior
  Hovering blocks highlights relationships and shows tooltips.

  Background:
    Given the user is viewing a trace in the flame graph

  Scenario: Hovering a block shows a tooltip
    When the user hovers over a span block
    Then a tooltip appears with span details

  Scenario: Hovering a block updates the context strip
    When the user hovers over a span block
    Then the context strip above the time axis shows that block's name, duration, % of parent, and % of trace

  Scenario: Hovering a block highlights its parent's time range
    When the user hovers over a child block
    Then a subtle highlighted band is drawn behind the parent's start..end on every depth row, with vertical guide lines at the parent's edges

  @planned
  # Not yet implemented as of 2026-05-01 — sibling dimming is conditional on trace size (`dimOnHover` only when ≤100 spans) and not implemented as a sibling-specific dim; this scenario is too imprecise to assert today.
  Scenario: Hovering a block highlights it and dims siblings
    When the user hovers over a span block
    Then that block is highlighted
    And its sibling blocks are dimmed


# ─────────────────────────────────────────────────────────────────────────────
# SIBLING GROUPING
# ─────────────────────────────────────────────────────────────────────────────

@planned
# Not yet implemented as of 2026-05-01 — sibling grouping is a Waterfall-only behavior; the Flame view always renders one block per span.
Rule: Flame graph sibling grouping
  When a span has many children with the same name, they are grouped into a single summary block.

  Background:
    Given the user is viewing a trace in the flame graph

  Scenario: Siblings with the same name are grouped when more than five
    Given a parent span has more than 5 children with the same name
    Then those children render as a single grouped block

  Scenario: Grouped block shows summary information
    Given siblings are grouped
    Then the grouped block displays the name, count, average duration, duration range, and error count

  Scenario: Grouped block renders with hatched styling
    Given siblings are grouped
    Then the grouped block renders as a hatched or striped block spanning the full range

  Scenario: Clicking a grouped block expands or zooms into it
    Given siblings are grouped
    When the user clicks the grouped block
    Then the grouped block expands to show individual sibling blocks or zooms into the group

  Scenario: Siblings with five or fewer same-named children are not grouped
    Given a parent span has 5 or fewer children with the same name
    Then each child renders as an individual block


# ─────────────────────────────────────────────────────────────────────────────
# EDGE CASES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Flame graph edge cases
  Handles unusual span structures gracefully.

  Background:
    Given the user is viewing a trace in the flame graph

  Scenario: Zero-duration spans render as minimum-width blocks
    Given a span has 0ms duration
    Then it renders as a minimum-width block
    And it is positioned at its start time
    And its details appear on hover

  Scenario: Very short spans hidden at current zoom show an indicator
    Given the trace has more than 200 spans rendered in the visible viewport
    And some of them are narrower than 0.1% of the viewport width
    Then a footer message reads "N spans too small to display — zoom in to see"

  Scenario: Zooming in reveals very short spans
    Given the footer indicates spans are too small to display
    When the user zooms in (drag-to-zoom on the time axis or wheel-zoom)
    Then those short spans become visible as the threshold is no longer met

  Scenario: Multi-root traces show top-level blocks side by side
    Given the trace has multiple root spans
    Then each root span renders as a top-level block on the time axis
    And each root has its own children below

  @planned
  # Not yet implemented as of 2026-05-01 — multi-root visual separators are a Waterfall-only treatment.
  Scenario: Multi-root traces with non-overlapping times show separators
    Given the trace has multiple root spans that do not overlap in time
    Then a subtle vertical separator appears between root groups

  Scenario: Orphaned spans render at root level
    Given the trace contains orphaned spans whose parent is not in the trace
    Then orphaned spans render at the root depth alongside other roots

  @planned
  # Not yet implemented as of 2026-05-01 — orphan dashed-border / hover warning treatments only exist in the Waterfall TreeRow.
  Scenario: Orphaned blocks show a missing-parent warning
    Given the trace contains an orphaned span
    When the user hovers over the orphaned span
    Then a warning indicator reads "parent not in trace"


# ─────────────────────────────────────────────────────────────────────────────
# TIME SCALE AND MINIMAP
# ─────────────────────────────────────────────────────────────────────────────

Rule: Flame graph time scale
  The time axis matches the trace duration and rescales when zoomed.

  Background:
    Given the user is viewing a trace in the flame graph

  Scenario: Time axis spans the full trace duration at root level
    Then the time axis displays a linear scale matching the trace duration

  Scenario: Time axis rescales when zoomed
    When the user zooms into a block
    Then the time axis rescales to show the zoomed block's duration

  Scenario: Minimap is always present at the bottom while there is a duration
    Then a minimap is rendered at the bottom of the flame view showing the full trace
    And a viewport indicator highlights the currently visible region (and updates as the user zooms or pans)


# ─────────────────────────────────────────────────────────────────────────────
# MOUSE INTERACTIONS SUMMARY
# ─────────────────────────────────────────────────────────────────────────────

Rule: Flame graph mouse interactions
  Mouse actions on the flame area produce consistent behaviors.

  Background:
    Given the user is viewing a trace in the flame graph

  Scenario: Wheel zooms the time axis toward the cursor
    When the user scrolls vertically with the wheel over the flame area
    Then the viewport zooms in or out, anchored on the cursor's time position

  Scenario: Shift-wheel or horizontal wheel pans the viewport
    When the user holds shift while scrolling, or scrolls horizontally
    Then the viewport pans by the wheel delta instead of zooming

  Scenario: Clicking empty space in the flame area clears the selection
    Given a span is currently selected
    When the user clicks on empty flame-area space (not on any block)
    Then the span tab closes and the selection is cleared


# ─────────────────────────────────────────────────────────────────────────────
# KEYBOARD NAVIGATION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Flame graph keyboard navigation
  Keyboard shortcuts for navigating and interacting with the flame graph when its container has focus.

  Background:
    Given the user is viewing a trace in the flame graph
    And the flame graph container has focus

  Scenario: Enter on a focused block animates a zoom-to-fit
    Given a block has keyboard focus
    When the user presses Enter
    Then the viewport animates a zoom-to-fit on that block and the span is selected

  Scenario: Space selects the focused block without zooming
    Given a block has keyboard focus
    When the user presses Space
    Then the span tab opens for that block
    And the viewport does not animate

  Scenario: Escape resets zoom, then clears the selection
    Given the user has zoomed in
    When the user presses Escape
    Then the viewport animates back to the full trace range
    Given the viewport is already at full range and a span is selected
    When the user presses Escape again
    Then the selection is cleared (and the drawer-level Esc cascade continues)

  Scenario: 0 or Home reset the zoom to the full trace range
    When the user presses "0" or Home
    Then the viewport animates back to the full trace range

  Scenario: + and - zoom around the viewport center
    When the user presses "+" or "="
    Then the viewport zooms in around its current center
    When the user presses "-" or "_"
    Then the viewport zooms out around its current center

  Scenario: Up and Down arrows move focus along the depth axis
    Given a child block has keyboard focus
    When the user presses Up
    Then focus moves to the parent block
    Given a block with children has keyboard focus
    When the user presses Down
    Then focus moves to its first child block

  Scenario: Left and Right arrows navigate between siblings of the focused block
    Given a block has keyboard focus
    When the user presses Left or Right (without shift)
    Then focus moves to the previous or next sibling block

  Scenario: Shift + Left / Right pans the viewport
    When the user holds Shift and presses Left or Right
    Then the viewport pans by ~20% of its current duration in that direction

  @planned
  # Not yet implemented as of 2026-05-01 — Backspace is not bound; users zoom out via Esc / 0 / Home / breadcrumb / Reset.
  Scenario: Backspace zooms out one level
    Given the user has zoomed in
    When the user presses Backspace
    Then the view zooms out one level


# ─────────────────────────────────────────────────────────────────────────────
# PERFORMANCE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Flame graph performance strategies
  Rendering uses depth-row virtualization plus a viewport-based filter for visible blocks.

  Background:
    Given the user is viewing a trace in the flame graph

  Scenario: Depth rows are virtualized
    Then only depth rows currently in the scrollable area are rendered (overscan ~4); other depths are skipped

  Scenario: Only blocks intersecting the time viewport are rendered
    When the viewport zooms or pans
    Then only nodes whose time range overlaps the viewport are passed to the depth rows

  Scenario: Above 200 visible spans, narrow blocks are counted as too-small-to-display
    Given the visible-block count exceeds 200
    Then any visible block whose width is less than 0.1% of the viewport contributes to the "N spans too small to display — zoom in to see" footer count

  Scenario: Hover-dim heuristic relaxes for very large traces
    Given the trace has more than 100 spans
    Then hover does not apply the sibling-dim treatment (it only applies on small traces)


# ─────────────────────────────────────────────────────────────────────────────
# DATA GATING
# ─────────────────────────────────────────────────────────────────────────────

Rule: Flame graph data gating
  Handles degenerate or incomplete trace data gracefully.

  Background:
    Given the user is viewing a trace in the flame graph

  Scenario: Single-span trace renders one full-width block
    Given the trace contains only one span
    Then a single block renders at full width

  @planned
  # Not yet implemented as of 2026-05-01 — span data shape always has start/end timestamps; no special "?" rendering.
  Scenario: Span with no timing data renders with unknown width
    Given a span has no timing data
    Then it renders as a block with a "?" label and no meaningful width
    And it is positioned at the trace start

  @planned
  # Not yet implemented as of 2026-05-01 — depth-based auto-collapse for large traces is not implemented in the Flame view.
  Scenario: Very deep traces auto-collapse levels beyond five
    Given the trace has more than 8 nesting levels
    Then children deeper than 5 levels are collapsed
    And a "N levels collapsed" indicator is shown with an option to expand
