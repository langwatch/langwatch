# PRD-013: Flame Graph

Parent: [Design: Trace v2](../design/trace-v2.md)
Decision: [ADR-001: Visualization Types](../decisions/adr-001-visualization-types.md)
Status: DRAFT
Date: 2026-04-22

## What This Is

The Flame Graph visualization in the trace drawer. Stacked blocks where parent spans sit on top and children below. Width is proportional to duration on the time axis. The key feature is **click-to-zoom**: click any span to zoom in, making it fill the full width so its children are clearly visible.

For shared behavior (colors, selection, hover, multi-root, orphans, 0ms spans), see PRD-007.

## When to Use Over Waterfall

- **Deep or complex traces** (20+ spans) where the waterfall tree gets overwhelming
- **"Where did the time go?"** — widest blocks immediately show where time was spent
- **Drilling into one branch** — click an agent span, see only what happened inside it at full width
- **Understanding proportional time** — "LLM calls took 80% of this trace" is immediately visible

The waterfall is better for: understanding execution order, seeing parallelism, simple traces.

## Layout

```
DEFAULT (full trace, not zoomed):
┌──────────────────────────────────────────────────────────────────┐
│  [Waterfall]  [Flame]  [Span List]                   [↕ expand] │
├──────────────────────────────────────────────────────────────────┤
│  0ms              500ms              1s              1.5s   2.3s │
│  ├─────────────────┼─────────────────┼────────────────┼──────┤  │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │                     agent.run (2.3s)                         ││
│  ├──────────────────────────┬─────────────────┬─────────────────┤│
│  │    llm.chat (1.1s)       │ llm.summ (0.8s) │ guard (0.1s)   ││
│  ├───────┬──────────────────┤                  │                ││
│  │ tool  │                  │                  │                ││
│  │(0.3s) │                  │                  │                ││
│  └───────┴──────────────────┴──────────────────┴────────────────┘│
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Block Layout

- **Parent on top, children below.** Each row = one depth level.
- **X-axis = time.** Position = start time, width = duration. Same time axis as waterfall.
- **Blocks are colored** by span type (same palette as PRD-007).
- **Labels inside blocks:** Span name + duration. If the block is too narrow for the full name, truncate. If too narrow for any text, show on hover only.
- **Gaps between siblings:** Visible gaps where no span was executing (idle time). These are real — the parent was active but no child was running. The gap is the parent's own processing time.
- **Depth:** One row per nesting level. Row height: ~32px.

### Block Content

Each block shows (space permitting):
- Span name (truncated if needed)
- Duration in parentheses
- If LLM span and block is wide enough: model name badge

If the block is too narrow for text, it still renders as a colored block with a hover tooltip.

## Zoom

The killer feature. Click any block to zoom into it.

```
ZOOMED INTO llm.chat (after clicking):
┌──────────────────────────────────────────────────────────────────┐
│  agent.run ▸ llm.openai.chat                     [← Zoom out]  │
├──────────────────────────────────────────────────────────────────┤
│  0ms                    300ms                    800ms     1.1s  │
│  ├───────────────────────┼───────────────────────┼──────────┤   │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────────┐│
│  │             llm.openai.chat (1.1s)   gpt-4o                 ││
│  ├──────────────────┬───────────────────────────────────────────┤│
│  │ tool.search_docs │                  (idle)                   ││
│  │ (0.3s)           │                                           ││
│  └──────────────────┴───────────────────────────────────────────┘│
│                                                                  │
│  Breadcrumb: agent.run ▸ llm.openai.chat                        │
└──────────────────────────────────────────────────────────────────┘
```

### Zoom Behavior

Two zoom modes:

**Click zoom:** Click a block → that block becomes full width. Time axis rescales to its duration. Only its children are shown below. The block's parent chain is shown as a breadcrumb above.

**Drag-to-zoom:** Click and drag horizontally across a time range → the view zooms to that range. A semi-transparent selection overlay shows the region being selected while dragging. Release to zoom. This works at any zoom level and is more precise than click-zoom for isolating a specific time window.

- **Breadcrumb** at top: `agent.run ▸ llm.openai.chat`. Each segment is clickable to zoom to that level.
- **[← Zoom out]** button: goes up one level. Or click a breadcrumb segment.
- **Click the zoomed block itself** again: selects it for the span tab (doesn't zoom further).
- **Double-click** a child block: zoom AND select for span tab.
- **Escape** while zoomed: zoom out one level. If at root level, Escape closes span tab (per PRD-004).

### Parent-Child Visual Hierarchy

The relationship between parent and child blocks must be visually clear:

- **Vertical alignment:** Children are directly below their parent, within the parent's horizontal bounds. A child block can never extend beyond its parent's edges.
- **Connecting lines:** Subtle vertical hairlines from the bottom of a parent block to the top of its children. Light gray, 1px. These lines make the "this belongs to that" relationship unambiguous.
- **Depth shading:** Each depth level gets a slightly different shade — deeper blocks are slightly lighter/more muted. Not dramatic, just enough to visually layer the blocks.
- **Hover highlight:** Hovering a block highlights it AND dims its siblings. The parent block gets a subtle top-border highlight. This makes the parent-child chain visible on hover.

### Zoom + Span Selection

Zoom and span selection are independent:
- Clicking a non-zoomed block → zoom into it (doesn't select for span tab yet)
- Once zoomed, clicking a child block → zoom into that child
- To select for span tab: click the currently-zoomed block, or double-click any block
- This means zoom is the primary interaction; span tab opening is secondary

## Sibling Grouping

When a span has many children with the same name (e.g., 77 "Scenario Turn"):

```
UNGROUPED (if expanded):
┌──────────────────────────────────────────────────────────────────┐
│                      scenario.run (45.2s)                        │
├──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┬──┤
│ST│ST│ST│ST│ST│ST│ST│ST│ST│ST│ST│ST│ST│ST│ST│ST│ST│ST│ST│ST│ST│ ...
│  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │  │
└──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┴──┘

GROUPED (default when >5 siblings with same name):
┌──────────────────────────────────────────────────────────────────┐
│                      scenario.run (45.2s)                        │
├──────────────────────────────────────────────────────────────────┤
│  Scenario Turn ×77  avg 0.5s  range 0.2s–1.1s  3 errors        │
│  ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
└──────────────────────────────────────────────────────────────────┘
```

- **Threshold:** Same as waterfall — group when >5 siblings share the same name
- **Grouped block:** Shows as a single hatched/striped block spanning the full range
- **Label:** Name, count, avg duration, duration range, error count
- **Click grouped block:** Expands to show all siblings as individual blocks. Or zooms into the group.
- **Performance:** Grouped rendering avoids rendering 77+ tiny blocks

## Handling Edge Cases

### 0ms Duration Spans

- Render as minimum-width blocks (4px wide)
- Colored by type, labeled on hover
- Positioned at their start time

### Very Short Spans Next to Very Long Spans

The bimodal duration distribution (many <10ms and many 30s+ spans) creates visualization problems. Zoom solves most of this:

- At full trace scale, very short spans may be too narrow to see
- Zooming into their parent makes them visible
- A subtle indicator on the parent block: "contains N hidden short spans" if children are too small to render at current zoom

### Multi-Root Traces

- Multiple top-level blocks, side by side on the time axis
- Each root gets its own column of children below
- Subtle vertical separator between root groups if they don't overlap in time

### Orphaned Spans

- Show at root level (top row) with a subtle dashed border
- ⚠ indicator on hover: "parent not in trace"

## Time Scale

- Same time axis as waterfall (linear, matches trace duration)
- Zoom (scroll or click-to-zoom) handles the scale issue naturally
- When zoomed, the time axis rescales to show the zoomed span's duration
- Minimap: when zoomed, show a tiny overview at the top with viewport indicator (same as waterfall)

## Interactions

| Action | Behavior |
|---|---|
| Click block | Zoom into that span (it becomes full width) |
| Click zoomed block | Select for span tab |
| Double-click block | Zoom + select for span tab |
| Click breadcrumb segment | Zoom to that level |
| [← Zoom out] button | Go up one zoom level |
| Hover block | Tooltip with span detail |
| Scroll | Zoom time axis (when not in click-zoom mode) |

### Keyboard

These shortcuts are scoped to the **Viz — Flame Graph** focus zone (see PRD-011 Focus Zone Model). They only fire when the flame graph has focus.

| Key | Action |
|---|---|
| **Enter** | Zoom into focused block |
| **Space** | Select focused block → open span tab (without zooming) |
| **Backspace** | Zoom out one level |
| **Escape** | Zoom out one level (if zoomed). If at root level, continues the Escape cascade (PRD-011). |
| **Up** | Move to parent block |
| **Down** | Move to first child block |
| **Left/Right** | Navigate between sibling blocks |

**Escape cascade:** When the flame graph is focused and zoomed, Escape zooms out one level. At root zoom level, the cascade continues: close span tab → close drawer → unfocus search. See PRD-011 for the full cascade definition.

## Performance

| Span count | Strategy |
|---|---|
| <50 | Render all blocks immediately |
| 50-200 | Group siblings >5. Render visible blocks. |
| 200+ | Group siblings >5. Only render blocks wider than 2px at current zoom. Show "N spans hidden at this zoom" indicator. |

## Data Gating

- **Single-span trace:** One block, full width. Not very useful — waterfall is better. But don't break.
- **No timing data:** Block with "?" and no width. Positioned at trace start.
- **Very deep traces (>8 levels):** Auto-collapse children deeper than 5 levels. Show "N levels collapsed" with expand.
