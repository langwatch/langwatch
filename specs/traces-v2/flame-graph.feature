# Flame Graph — Gherkin Spec
# Based on PRD-013: Flame Graph
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

  Scenario: LLM span shows model name badge when wide enough
    Given a block represents an LLM span
    And the block is wide enough for extra content
    Then a model name badge is displayed inside the block

  Scenario: Depth shading distinguishes nesting levels
    Then deeper blocks render with a slightly lighter or more muted shade than shallower blocks


# ─────────────────────────────────────────────────────────────────────────────
# CLICK-TO-ZOOM
# ─────────────────────────────────────────────────────────────────────────────

Rule: Flame graph click-to-zoom
  Clicking any block zooms in so it fills the full width and only its children are shown below.

  Background:
    Given the user is viewing a trace in the flame graph

  Scenario: Clicking a block zooms into it
    When the user clicks a span block
    Then that block expands to fill the full width
    And the time axis rescales to that block's duration
    And only that block's children are shown below it

  Scenario: Clicking a block does not open the span tab
    When the user clicks a span block to zoom
    Then the span tab does not open

  Scenario: Clicking the currently zoomed block selects it for the span tab
    Given the user has zoomed into a block
    When the user clicks that same block again
    Then the span tab opens showing that block's details

  Scenario: Double-clicking a block zooms and selects
    When the user double-clicks a span block
    Then the view zooms into that block
    And the span tab opens showing that block's details

  Scenario: Zooming into a child while already zoomed
    Given the user has zoomed into a parent block
    When the user clicks a child block
    Then the view zooms into that child block


# ─────────────────────────────────────────────────────────────────────────────
# DRAG-TO-ZOOM
# ─────────────────────────────────────────────────────────────────────────────

Rule: Flame graph drag-to-zoom
  Click and drag horizontally to zoom into a specific time range.

  Background:
    Given the user is viewing a trace in the flame graph

  Scenario: Dragging horizontally shows a selection overlay
    When the user clicks and drags horizontally across blocks
    Then a semi-transparent selection overlay highlights the dragged region

  Scenario: Releasing the drag zooms to the selected time range
    When the user completes a horizontal drag selection
    Then the view zooms to show only the selected time range

  Scenario: Drag-to-zoom works at any zoom level
    Given the user has already zoomed into a block
    When the user performs a horizontal drag selection
    Then the view zooms further into the selected time range


# ─────────────────────────────────────────────────────────────────────────────
# BREADCRUMBS AND ZOOM NAVIGATION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Flame graph breadcrumbs and zoom navigation
  Breadcrumbs and controls allow navigating between zoom levels.

  Background:
    Given the user is viewing a trace in the flame graph
    And the user has zoomed into a block

  Scenario: Breadcrumb shows parent chain of zoomed block
    Then a breadcrumb trail appears above the flame graph
    And the breadcrumb shows the full parent chain separated by arrows

  Scenario: Clicking a breadcrumb segment zooms to that level
    When the user clicks a breadcrumb segment
    Then the view zooms to show that ancestor block at full width

  Scenario: Zoom out button goes up one level
    When the user clicks the zoom out button
    Then the view zooms out to the parent of the currently zoomed block

  Scenario: Zoom out at root level has no effect on zoom
    Given the user is viewing the root zoom level
    Then the zoom out button is not shown or is disabled


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

  Scenario: Hovering a block highlights it and dims siblings
    When the user hovers over a span block
    Then that block is highlighted
    And its sibling blocks are dimmed

  Scenario: Hovering a block highlights its parent
    When the user hovers over a child block
    Then the parent block receives a subtle top-border highlight


# ─────────────────────────────────────────────────────────────────────────────
# SIBLING GROUPING
# ─────────────────────────────────────────────────────────────────────────────

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
    Given a parent block contains children too short to render at the current zoom level
    Then the parent block shows an indicator with the count of hidden short spans

  Scenario: Zooming into the parent reveals very short spans
    Given a parent block has hidden short-span children
    When the user zooms into that parent block
    Then the short child spans become visible

  Scenario: Multi-root traces show top-level blocks side by side
    Given the trace has multiple root spans
    Then each root span renders as a top-level block on the time axis
    And each root has its own children below

  Scenario: Multi-root traces with non-overlapping times show separators
    Given the trace has multiple root spans that do not overlap in time
    Then a subtle vertical separator appears between root groups

  Scenario: Orphaned spans render at root level with dashed border
    Given the trace contains orphaned spans whose parent is not in the trace
    Then orphaned spans render at the root level
    And they display a dashed border

  Scenario: Hovering an orphaned span shows a warning
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

  Scenario: Minimap appears when zoomed
    When the user zooms into a block
    Then a minimap overview appears at the top
    And the minimap shows a viewport indicator highlighting the visible region


# ─────────────────────────────────────────────────────────────────────────────
# MOUSE INTERACTIONS SUMMARY
# ─────────────────────────────────────────────────────────────────────────────

Rule: Flame graph mouse interactions
  Mouse actions on blocks produce consistent behaviors.

  Background:
    Given the user is viewing a trace in the flame graph

  Scenario: Scroll zooms the time axis when not in click-zoom mode
    Given the user has not click-zoomed into any block
    When the user scrolls over the flame graph
    Then the time axis zooms in or out


# ─────────────────────────────────────────────────────────────────────────────
# KEYBOARD NAVIGATION
# ─────────────────────────────────────────────────────────────────────────────

Rule: Flame graph keyboard navigation
  Keyboard shortcuts for navigating and interacting with the flame graph when it has focus.

  Background:
    Given the user is viewing a trace in the flame graph
    And the flame graph focus zone is active

  Scenario: Enter zooms into the focused block
    Given a block has keyboard focus
    When the user presses Enter
    Then the view zooms into that block

  Scenario: Space selects the focused block for the span tab
    Given a block has keyboard focus
    When the user presses Space
    Then the span tab opens showing that block's details
    And the view does not zoom

  Scenario: Backspace zooms out one level
    Given the user has zoomed into a block
    When the user presses Backspace
    Then the view zooms out one level

  Scenario: Escape zooms out one level when zoomed
    Given the user has zoomed into a block
    When the user presses Escape
    Then the view zooms out one level

  Scenario: Escape at root level continues the escape cascade
    Given the user is at the root zoom level
    When the user presses Escape
    Then the escape cascade continues to close the span tab or drawer

  Scenario: Up arrow moves focus to the parent block
    Given a child block has keyboard focus
    When the user presses Up
    Then focus moves to the parent block

  Scenario: Down arrow moves focus to the first child block
    Given a block with children has keyboard focus
    When the user presses Down
    Then focus moves to its first child block

  Scenario: Left and Right arrows navigate between siblings
    Given a block has keyboard focus
    When the user presses Left or Right
    Then focus moves to the previous or next sibling block


# ─────────────────────────────────────────────────────────────────────────────
# PERFORMANCE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Flame graph performance strategies
  Rendering strategies adapt to span count for smooth interaction.

  Background:
    Given the user is viewing a trace in the flame graph

  Scenario: Traces under 50 spans render all blocks immediately
    Given the trace has fewer than 50 spans
    Then all blocks render immediately without grouping or culling

  Scenario: Traces with 50 to 200 spans group siblings and render visible blocks
    Given the trace has between 50 and 200 spans
    Then siblings with more than 5 same-named children are grouped
    And only visible blocks are rendered

  Scenario: Traces with more than 200 spans cull narrow blocks
    Given the trace has more than 200 spans
    Then siblings with more than 5 same-named children are grouped
    And blocks narrower than 2 pixels at the current zoom are not rendered
    And an indicator shows the count of spans hidden at this zoom level


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

  Scenario: Span with no timing data renders with unknown width
    Given a span has no timing data
    Then it renders as a block with a "?" label and no meaningful width
    And it is positioned at the trace start

  Scenario: Very deep traces auto-collapse levels beyond five
    Given the trace has more than 8 nesting levels
    Then children deeper than 5 levels are collapsed
    And a "N levels collapsed" indicator is shown with an option to expand
