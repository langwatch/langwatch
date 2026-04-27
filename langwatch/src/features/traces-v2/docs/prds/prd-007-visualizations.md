# PRD-007: Visualizations — Shared Behavior & Waterfall

Parent: [Design: Trace v2](../design/trace-v2.md)
Decision: [ADR-001: Visualization Types](../decisions/adr-001-visualization-types.md)
Status: DRAFT
Date: 2026-04-22

## What This Is

The execution visualization section of the trace drawer. Three views — Waterfall (default), Flame Graph (PRD-013), and Span List (PRD-014) — each showing the same span data through a different lens. This PRD covers shared behavior across all three views and the full spec for the Waterfall view.

See [ADR-001](../decisions/adr-001-visualization-types.md) for the data analysis and rationale behind the choice of these three views.

## Data Shape (from ClickHouse analysis)

These numbers inform all visualization design decisions:

- **79% of traces have ≤5 spans.** Most traces are simple. The UI must feel clean and fast for the common case.
- **0.06% of traces have 50+ spans** (max: 299 in dev, 439 in summaries). Rare but real.
- **Max nesting depth is ~5 levels.** Traces are shallow, not deep like CPU call stacks.
- **Complex traces are flat-wide:** 77 siblings at one level (repeated "Scenario Turn"), not deeply nested chains. Sibling grouping is more important than deep-tree handling.
- **41% of traces have duplicate span names.** "tool_0" appears 5x, "Scenario Turn" appears 77x. Must differentiate same-named spans.
- **6.4% of spans have 0ms duration.** Must be visible, not invisible.
- **33% of traces have 2+ root spans** (multi-root forest). The viewer must handle a forest, not assume a single tree.
- **7.2% of traces are orphaned** — all spans reference parents that aren't in the trace. Need fallback rendering.
- **Duration is bimodal:** lots of <10ms spans AND lots of 30s+ spans. A linear time scale doesn't work.
- **Top span types:** LLM (36%), Tool (11%), Generic span (10%), Evaluation (9%), Chain (7%), Agent (7%), Module (6%), RAG (3%).

## Layout Within Drawer

```
┌──────────────────────────────────────────────────────────┐
│  HEADER (PRD-008)                                        │
│  ALERTS (PRD-004)                                        │
├──────────────────────────────────────────────────────────┤
│  [Waterfall]  [Flame]  [Span List]         [↕ expand]   │ ← THIS SECTION
│                                                          │
│  ...visualization content...                             │
│                                                          │
├──────────────────────────────────────────────────────────┤
│  TAB BAR: [Trace Summary] [span tab]  (PRD-004)               │
│  DETAIL ACCORDIONS (PRD-005/006)                         │
└──────────────────────────────────────────────────────────┘
```

- Three tab buttons switch between views. Keyboard: 1/2/3 to switch.
- **All visualizations must fit within the drawer width without horizontal scrolling.** The viz container is 100% of the drawer content area. Internal elements (tree columns, timeline, flame blocks, span list table) use percentage-based widths or flex layout to fill the available space. No horizontal overflow.
- Height modes:
  - **Collapsed:** ~120px, compressed overview (mini bars, no labels)
  - **Default:** ~250px, comfortable view
  - **Expanded:** ~450px+, for complex traces
- Draggable resize handle between visualization and tab bar/accordions
- Selected view is persisted in localStorage (user preference)

## Shared Behavior (all three views)

### Span Selection

- **Click any span** in any view → opens span tab (PRD-006) with fade animation
- **Click same span again** → closes span tab, back to Trace Summary
- **Selected span:** highlighted (brighter border or background). All other spans slightly dimmed.
- Span selection is synchronized across views — selecting in Waterfall highlights in Flame and Span List if you switch.

### Hover

- Tooltip on hover: span name, type badge, duration, cost (if applicable), model (if LLM)
- Hovering a span in the viz highlights the corresponding `┈ from [span name]` links in the Trace Summary tab's events/evals, and vice versa (hovering a span origin link in events/evals highlights the span in the viz)

### Color Coding by Span Type

Consistent across all three views:

| Type | Color | Icon |
|---|---|---|
| LLM | Blue (`#4299E1`) | ◈ |
| Tool | Green (`#48BB78`) | ⚙ |
| Agent | Purple (`#9F7AEA`) | ◎ |
| RAG | Orange (`#ED8936`) | ⊛ |
| Guardrail | Yellow (`#ECC94B`) | ◉ |
| Evaluation | Teal (`#38B2AC`) | ◇ |
| Generic span | Gray (`#A0AEC0`) | ○ |

- **Error spans:** Red border/marker (`#E53E3E`) overrides type color on the border/outline, but the fill stays the type color. This way you can see both "what type" and "did it error" at once.

### Multi-Root Traces (forests)

33% of traces have 2+ root spans. All views handle this as a forest:

- **Waterfall:** Multiple root-level rows, each with its own tree. A subtle separator between root groups if roots are clearly separate operations.
- **Flame:** Multiple top-level blocks side by side or stacked.
- **Span List:** All spans shown regardless of root — flat table doesn't care about roots.

### Orphaned Spans

7.2% of traces have spans whose parents aren't in the trace:

- Show orphaned spans as root-level entries with a subtle indicator: `⚠ parent not in trace`
- Don't hide them — they might be the only spans in the trace
- In the tree, orphaned spans appear at root level with a broken-link icon

### 0ms Duration Spans

6.4% of spans have zero duration:

- **Waterfall:** Show as a thin vertical line (2px) or diamond marker, not invisible. Still clickable.
- **Flame:** Show as minimum-width block (4px). Labeled on hover.
- **Span List:** Show `<1ms` in the duration column.

### Collapsed State

When the visualization section is collapsed (~120px):
- Show a single-line compressed overview: mini timing bars stacked, no labels, just the color pattern
- Enough to see the rough shape of the trace (span count, parallelism, where errors are)
- Click anywhere to expand

## Waterfall View (default)

The primary view. Tree hierarchy on the left, timeline bars on the right.

```
┌──────────────────────────────────────────────────────────────────┐
│  [Waterfall]  [Flame]  [Span List]                   [↕ expand] │
├──────────────────────────────────────────────────────────────────┤
│                                 │                                │
│  Span                           │ 0ms   500ms    1s   1.5s  2.3s│
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │ ┼───────┼──────┼─────┼─────┤ │
│                                 │                                │
│  ▼ ◎ agent.run           2.3s  │ ████████████████████████████   │
│    ▼ ◈ llm.chat          1.1s  │ ████████████                   │
│        gpt-4o  520→380 $0.002  │                                 │
│      ⚙ tool.search       0.3s  │    ██████                      │
│      ◈ llm.summarize     0.8s  │          █████████             │
│        gpt-4o  380→220 $0.001  │                                 │
│    ◉ guardrail.pii       0.1s  │                          ████  │
│                                 │                                │
└──────────────────────────────────────────────────────────────────┘
```

### Left Side: Span Tree

- **Tree structure:** Collapsible with ▼/▶ arrows on parent spans
- **Span icon:** Type-colored icon (see color table above)
- **Span name:** Monospace. Truncated with tooltip if long.
- **Duration:** Right-aligned before the divider, monospace
- **LLM metadata** (below span name, slightly indented, muted text): model name, token count (in→out), cost. Only for LLM spans. Only shown if data exists.
- **Error indicator:** Red ⚠ icon if span has error status
- **Indentation:** ~20px per nesting level
- **Expand all / Collapse all:** Small buttons in the header
- **Row height:** ~28px per span (compact), ~36px for LLM spans with metadata line

**Tree column min-width:** The tree column must have a minimum width of ~200px. The span name must never be completely hidden — always show at least the first 8-10 characters with ellipsis truncation. Full name on hover tooltip.

### Right Side: Timeline

- **Time axis at top:** Marks showing the trace's time range (0ms → total duration)
- **Bars:** Horizontal, positioned by start time relative to trace start, width = duration
- **Color:** Fill color by span type, slightly rounded corners
- **Vertical alignment:** Each bar aligns with its span row on the left
- **Grid lines:** Subtle vertical lines at time markers for visual alignment
- **Resizable divider:** ~40/60 split between tree and timeline, draggable

### Time Scale

The bimodal duration distribution (lots of <10ms AND lots of 30s+) means a linear scale doesn't work:

- **Default:** Linear scale that fits the trace duration
- **Zoom:** Scroll on the timeline to zoom in/out. Drag to pan.
- **Adaptive:** If the trace has a mix of very short and very long spans, show a subtle break indicator (like a zigzag) on very long idle gaps to compress dead time. This keeps short spans visible without making the timeline absurdly wide.
- **Minimap:** When zoomed in, show a tiny overview bar (~20px tall) at the top of the timeline showing the full trace as compressed colored bars. A semi-transparent rectangle indicates the viewport (the portion you're zoomed into). **Interactions:** Click anywhere on the minimap → jump the viewport to that position. Drag the viewport rectangle → pan smoothly. The minimap is always non-interactive when not zoomed (hidden or inert).

### Sibling Grouping (Repeated Spans)

When a parent has many children with the same span name (e.g., 77 "Scenario Turn" spans), the tree collapses them:

```
UNGROUPED (too many):
│  ▼ ◎ scenario.run               45.2s  │ █████████████████████│
│    ○ Scenario Turn         0.6s  │ █                          │
│    ○ Scenario Turn         0.5s  │  █                         │
│    ○ Scenario Turn         0.4s  │   █                        │
│    ... (74 more identical rows)                                │

GROUPED (default when >5 siblings with same name):
│  ▼ ◎ scenario.run               45.2s  │ █████████████████████│
│    ▶ ○ Scenario Turn  ×77  avg 0.5s    │ ████████████████████ │
│        range: 0.2s–1.1s, 3 errors      │ (shows as dense bar) │
│                                          │                      │
│  Click ▶ to expand all 77.              │                      │
│  Or click the group to see them         │                      │
│  in the Span List view (auto-filtered). │                      │
```

- **Threshold:** Group when >5 siblings share the same name under one parent
- **Group row shows:** span name, count (×77), average duration, duration range, error count
- **Timeline bar:** Shows as a dense/hatched bar spanning the full range of the grouped spans
- **Expand:** Click ▶ to expand all siblings (may trigger virtualization for large groups)
- **Jump to Span List:** A subtle link to switch to Span List view, pre-filtered to these spans. Better for comparing 77 instances than scrolling a tree.

### Interactions

| Action | Behavior |
|---|---|
| Click span row or bar | Select span → open span tab |
| Click ▼/▶ arrow | Expand/collapse children |
| Hover span row or bar | Tooltip with span detail |
| Scroll on timeline | Zoom in/out |
| Drag on timeline | Pan |
| Drag divider | Resize tree/timeline split |
| Expand all / Collapse all | Header buttons |
| Click grouped siblings ▶ | Expand all siblings |

### Performance

| Span count | Strategy |
|---|---|
| <50 | Render all spans immediately |
| 50-200 | Render visible spans, virtualize off-screen rows |
| 200+ | Auto-collapse children deeper than 2 levels. Auto-group siblings >5. Show "N spans collapsed" with expand button. Virtualize. |

## Data Gating

- **Single-span traces:** One row/bar. Still useful for the metrics. Don't hide the viz.
- **No timing data:** Show in tree only (no bar). Muted text: "no timing data".
- **0ms spans:** Thin vertical line (2px) or diamond marker in timeline. Still clickable.
- **Orphaned spans:** Root-level with ⚠ indicator.
- **Multi-root:** Multiple root-level entries, subtle separator between root groups.
