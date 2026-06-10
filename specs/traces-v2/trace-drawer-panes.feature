# Trace Drawer Panes — DevTools-style layout
#
# Implementation:
#   langwatch/src/features/traces-v2/components/TraceDrawer/TraceDrawerShell.tsx
#   langwatch/src/features/traces-v2/components/TraceDrawer/panes/*
#   langwatch/src/features/traces-v2/stores/drawerStore.ts (widthPx, paneState, layoutMode)
#
# Motivation: the drawer was previously a single scroll container with a
# fixed 45% / "maximized" toggle. Operators on laptops reported having to
# scroll the whole drawer to navigate between a span and its details, and
# the drag affordance on the left edge was effectively invisible. This
# spec adopts the Chrome DevTools "Network → Headers/Preview/Response"
# model: independent, resizable, collapsible panes inside one drawer.

Feature: Trace drawer panes and resize

# ─────────────────────────────────────────────────────────────────────────────
# DRAWER WIDTH — DRAGGABLE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Drawer width is fully draggable, not a binary toggle
  The drawer's width is a continuous value the operator can drag, persisted
  to localStorage and constrained by sensible min/max bounds.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the drawer is open

  Scenario: Default width matches the previous overlay width
    When the drawer first opens with no persisted width
    Then `drawerStore.widthPx` is `null`
    And `Drawer.Content` renders at approximately 45% of the viewport width

  Scenario: Drag the left-edge grip to resize the drawer
    When the user presses and drags the left-edge grip leftward by N pixels
    Then `drawerStore.widthPx` updates to `currentWidth + N` on each pointermove
    And the drawer width follows the cursor

  Scenario: Width is clamped to a minimum
    When the user drags the grip past the minimum bound
    Then the drawer width does not go below ~360px

  Scenario: Width is clamped to a maximum
    When the user drags the grip past the maximum bound
    Then the drawer width does not exceed `viewport - 80px`
    And the page edge remains clickable for "click-outside" behaviour

  Scenario: Width persists across sessions
    Given the user has dragged the drawer to a specific width
    When the user reloads the page and re-opens the drawer
    Then the drawer opens at the persisted width

  Scenario: Double-click the grip toggles maximize and restore
    When the user double-clicks the grip
    Then the drawer width snaps to `viewport - 10px`
    When the user double-clicks the grip a second time
    Then the drawer width restores to its prior persisted width

  Scenario: Single-click the grip does NOT toggle width
    When the user clicks (without dragging) on the grip
    Then the drawer width does not change
    # (Previously a single click toggled maximize — now reserved for the
    # explicit double-click gesture so accidental clicks don't snap.)


# ─────────────────────────────────────────────────────────────────────────────
# LEFT-EDGE GRIP — VISIBLE PILL
# ─────────────────────────────────────────────────────────────────────────────

Rule: The left-edge grip has a visible vertical pill affordance
  The grip mirrors the evaluations-v3 EditableCell expansion handle: a
  small rounded gray pill sits on the outer edge of the drawer; the whole
  vertical rail around the pill is the draggable hit area.

  Background:
    Given the drawer is open

  Scenario: Pill is rendered on the outer left edge
    Then a vertical pill (~4px × 40px, `gray.emphasized`, rounded full) is
      centered on the left edge of `Drawer.Content`
    And the pill is non-interactive (pointerEvents: none) — it is purely
      a visual affordance

  Scenario: Hit area covers full drawer height
    Then a transparent rail spanning the full drawer height sits flush to
      the drawer's left edge with `cursor: col-resize`
    And dragging anywhere on that rail begins resizing

  Scenario: Pill is more visible on hover and while dragging
    When the user hovers the rail
    Then the pill opacity rises from `0.5` to `1.0`
    When the user is actively dragging
    Then the pill stays at full opacity for the duration of the gesture

  Scenario: Rail is not keyboard-focusable
    When the user presses Tab repeatedly
    Then the grip rail never receives focus
    # (Previously the invisible rail had `tabIndex={0}`, producing a
    # disorienting focus outline. The maximize gesture is reachable via
    # the M keyboard shortcut instead.)


# ─────────────────────────────────────────────────────────────────────────────
# LAYOUT MODE — VERTICAL VS HORIZONTAL
# ─────────────────────────────────────────────────────────────────────────────

Rule: Layout adapts to drawer aspect ratio
  When the drawer is wider than tall — typical on laptops once the
  operator drags it wide — the panes flip into a side-by-side layout
  (visualization on the left, span detail on the right) like the
  DevTools Network → Headers/Preview split. Otherwise, panes stack
  vertically as before.

  Background:
    Given the drawer is open in Trace mode
    And a span is selected

  Scenario: Vertical layout when drawer is taller than wide
    Given the drawer's inner content area has `width <= height`
    Then the visualization pane is rendered above the span-detail pane
    And a horizontal `<PanelResizeHandle>` separates them

  Scenario: Horizontal layout when drawer is wider than tall
    Given the drawer's inner content area has `width > height`
    Then the visualization pane is rendered on the left
    And the span-detail pane is rendered on the right
    And a vertical `<PanelResizeHandle>` separates them
    And the layout matches the "Chrome DevTools Network tab" mental model

  Scenario: Layout flips live as the user drags the drawer wider
    Given the drawer is in vertical layout
    When the user drags the drawer width such that width > height
    Then the layout transitions to horizontal without remounting the
      heavy panel children (viz keeps its zoom, span detail keeps its scroll)

  Scenario: Conversation context pane stays at the top regardless of layout
    Given the trace belongs to a conversation
    Then the conversation context pane is rendered above the viz/detail
      split in both vertical and horizontal layouts


# ─────────────────────────────────────────────────────────────────────────────
# PANES — STRUCTURE AND BEHAVIOUR
# ─────────────────────────────────────────────────────────────────────────────

Rule: The drawer body is a stack of independent panes, not a single scroll
  Each section inside the drawer is wrapped as a `Pane` with its own
  header bar, its own collapse/expand state, and its own scroll
  container. The drawer body itself does not scroll.

  Background:
    Given the drawer is open in Trace mode

  Scenario: Drawer body does not scroll
    Then `Drawer.Body` has `overflow: hidden` (not `auto`)
    And there is no global vertical scrollbar on the drawer

  Scenario: Each pane has a header bar
    Then each pane renders a header with:
      | element              | role                                        |
      | title                | human-readable section label                |
      | collapse/expand icon | toggles `paneState[id].collapsed`           |
      | maximize icon        | toggles `paneState[id].maximizedWithinGroup`|

  Scenario: Pane header uses gray background
    Then the pane header bar uses a muted gray background
    And the pane content area uses the surface (white in light mode) background
    # Inverted from the previous layout where the section "Conversation
    # Context" block had a `bg.subtle` body and no header bar.

  Scenario: Collapsing a pane reduces it to header-only
    When the user clicks the collapse icon on a pane
    Then `paneState[id].collapsed` becomes true
    And the pane renders only its header bar (~32px)
    And the freed vertical/horizontal space is given to its sibling panes

  Scenario: Re-expanding a collapsed pane
    Given a pane is collapsed
    When the user clicks the collapse icon (now an expand chevron) again
    Then the pane content re-appears
    And the previously remembered size is restored

  Scenario: Maximize-within-group hides siblings
    When the user double-clicks a pane header
    Then `paneState[id].maximizedWithinGroup` becomes true
    And sibling panes in the same group are collapsed
    When the user double-clicks the header again
    Then sibling panes are restored to their prior sizes

  Scenario: Pane sizes persist across sessions
    When the user drags a `<PanelResizeHandle>` to change a pane's relative size
    Then the new size persists to localStorage under
      `langwatch:traces-v2:drawer-pane-sizes:v1`
    And re-opening the drawer in the same layout restores those sizes


# ─────────────────────────────────────────────────────────────────────────────
# CLICK-TO-INTERACT IS REMOVED
# ─────────────────────────────────────────────────────────────────────────────

Rule: The "Click to interact" overlay is gone
  Because each pane has its own scroll container, wheel events naturally
  scope to the pane the cursor is over. The previous scrim — needed when
  there was a single drawer scroller above interactive viz canvases — is
  redundant.

  Background:
    Given the drawer is open in Trace mode

  Scenario: VizPlaceholder has no scrim overlay
    Then no "Click to interact" badge is rendered over the visualization
    And the visualization captures wheel events as soon as the cursor
      enters it

  Scenario: IOViewer has no scrim overlay
    Then no "Click to interact" badge is rendered over the IO viewer
    And the IO viewer captures wheel events as soon as the cursor
      enters it
