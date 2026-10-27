Feature: Trace flame graph
  The trace web package renders span timing, hierarchy, and navigation while
  the app supplies loaded rows and selection/transport composition.

  Background:
    Given the user is viewing a trace with multiple spans in the trace drawer
    And the Flame Graph tab is selected

  Rule: Block layout and labels

    Scenario: Parent spans render above their children
      Then each parent span renders in the row above its children
      And each depth level occupies one row

    Scenario: Block width is proportional to duration on the time axis
      Then each block's position corresponds to its start time
      And each block's width is proportional to its duration

    Scenario: Blocks are colored by span type
      Then each block uses the shared span type palette

    Scenario: Gaps between siblings show idle time
      Given a parent span has children that do not cover its full duration
      Then visible gaps appear between child blocks

    Scenario: Children stay within parent horizontal bounds
      Then no child block extends beyond its parent's horizontal range

    Scenario: Block shows span name and duration when wide enough
      Given a block has sufficient width for text
      Then it displays the span name and duration

    Scenario: Block truncates label when moderately narrow
      Given a block is too narrow for the full span name
      Then the name is truncated but partially visible

    Scenario: Block shows no text when very narrow
      Given a block is too narrow for any text
      Then it renders as a colored block with its details in a tooltip

    Scenario: LLM span shows model name inline when wide enough
      Given a wide block represents an LLM span
      Then its label includes the abbreviated model name

  Rule: Click, zoom, and breadcrumbs

    Scenario: Clicking a block selects the span and opens the span tab
      When the user clicks a span block
      Then the span is selected and its details tab opens
      And the focused-span ring is set on the block

    Scenario: Double-clicking a block animates a zoom-to-fit
      When the user double-clicks a span block
      Then the time axis fits that block with small padding
      And the span is selected

    Scenario: Breadcrumb of the focused span shows when zoomed
      Given the user has zoomed or focused a deeply nested block
      Then a breadcrumb shows the root-to-focused ancestor chain
      And clicking an ancestor animates a zoom to that block

    Scenario: Reset button returns to the full trace range
      Given the time axis is zoomed
      When the user clicks Reset or presses Escape, 0, or Home
      Then the viewport animates back to the full trace range

  Rule: Time-axis and flame-area interaction

    Scenario: Dragging horizontally on the time axis shows a selection overlay
      When the user drags horizontally on the time-axis strip
      Then a blue selection overlay with a duration tooltip is shown

    Scenario: Releasing the time-axis drag zooms to the selected range
      When the user completes a horizontal time-axis drag
      Then the viewport animates to the selected time range

    Scenario: Drag-to-zoom works at any zoom level
      Given the user has already zoomed in
      When the user drags on the time axis
      Then the view zooms further into the selected range

    Scenario: Dragging on the flame area pans rather than zooming
      When the user drags horizontally on the flame area
      Then the viewport pans and no selection overlay is drawn

    Scenario: Wheel zooms the time axis toward the cursor
      When the user scrolls vertically over the flame area
      Then the viewport zooms around the cursor's time position

    Scenario: Shift-wheel or horizontal wheel pans the viewport
      When the user holds Shift or scrolls horizontally
      Then the viewport pans by the wheel delta

    Scenario: Clicking empty space in the flame area clears the selection
      Given a span is currently selected
      When the user clicks empty flame-area space
      Then the selection is cleared and the span tab closes

  Rule: Hover and relationship context

    Scenario: Hovering a block shows a tooltip
      When the user hovers over a span block
      Then a tooltip appears with span details

    Scenario: Hovering a block updates the context strip
      When the user hovers over a span block
      Then the context strip shows its name, duration, parent ratio, and trace ratio

    Scenario: Hovering a block highlights its parent's time range
      When the user hovers over a child block
      Then the parent's time range is highlighted with edge guides

  Rule: Edge cases and time scale

    Scenario: Zero-duration spans render as minimum-width blocks
      Given a span has zero duration
      Then it renders at its start time with a minimum-width block

    Scenario: Very short spans hidden at current zoom show an indicator
      Given more than 200 visible spans include blocks narrower than 0.1 percent
      Then a footer says they are too small to display and invites zooming in

    Scenario: Zooming in reveals very short spans
      Given the footer indicates spans are too small
      When the user zooms in
      Then those short spans become visible

    Scenario: Multi-root traces show top-level blocks side by side
      Given the trace has multiple root spans
      Then each root renders at top level with its own children

    Scenario: Orphaned spans render at root level
      Given a span's parent is not in the trace
      Then the span renders at root depth

    Scenario: Time axis spans the full trace duration at root level
      Then the time axis displays a linear scale matching the trace duration

    Scenario: Time axis rescales when zoomed
      When the user zooms into a block
      Then the time axis shows the zoomed block's duration

    Scenario: Minimap is shown while the viewport is zoomed
      Given the trace has a positive duration and the viewport is zoomed
      Then a minimap shows the full trace and current viewport

  Rule: Keyboard navigation

    Background:
      Given the flame graph container has focus

    Scenario: Enter on a focused block animates a zoom-to-fit
      Given a block has keyboard focus
      When the user presses Enter
      Then the block is selected and the viewport zooms to fit it

    Scenario: Space selects the focused block without zooming
      Given a block has keyboard focus
      When the user presses Space
      Then the block is selected without changing the viewport

    Scenario: Escape resets zoom, then clears the selection
      Given the user is zoomed in
      When the user presses Escape
      Then the viewport resets
      Given the viewport is at full range and a span is selected
      When the user presses Escape again
      Then the selection is cleared

    Scenario: 0 or Home reset the zoom to the full trace range
      When the user presses 0 or Home
      Then the viewport resets to the full trace range

    Scenario: Plus and minus zoom around the viewport center
      When the user presses plus or minus
      Then the viewport zooms around its current center

    Scenario: Up and Down arrows move focus along the depth axis
      Given a child has keyboard focus
      When the user presses Up or Down
      Then focus moves to the parent or first child

    Scenario: Left and Right arrows navigate between siblings
      Given a block has keyboard focus
      When the user presses Left or Right without Shift
      Then focus moves to the previous or next sibling

    Scenario: Shift and Left or Right pan the viewport
      When the user presses Shift with Left or Right
      Then the viewport pans by about 20 percent

  Rule: Performance and data gating

    Scenario: Depth rows are virtualized
      Then only visible depth rows plus overscan are rendered

    Scenario: Only blocks intersecting the time viewport are rendered
      When the viewport zooms or pans
      Then only overlapping nodes are passed to depth rows

    Scenario: Above 200 visible spans, narrow blocks are counted
      Given more than 200 blocks are visible
      Then blocks narrower than 0.1 percent contribute to the footer count

    Scenario: Hover dimming relaxes for very large traces
      Given the trace has more than 100 spans
      Then hover does not apply the small-trace dim treatment

    Scenario: Single-span trace renders one full-width block
      Given the trace contains only one span
      Then one block renders at full width
