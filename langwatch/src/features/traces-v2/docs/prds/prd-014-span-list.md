# PRD-014: Span List

Parent: [Design: Trace v2](../design/trace-v2.md)
Decision: [ADR-001: Visualization Types](../decisions/adr-001-visualization-types.md)
Status: DRAFT
Date: 2026-04-22

## What This Is

A flat, sortable, filterable table of every span in a trace. No hierarchy, no timeline — just data. The "spreadsheet view" for when you need to answer a specific question: "which span was slowest?", "how much did LLM calls cost?", "show me all tool calls."

For shared behavior (colors, selection, hover), see PRD-007.

## When to Use Over Waterfall/Flame

- **"Which span was slowest?"** → sort by duration
- **"Which LLM calls cost the most?"** → filter to LLM, sort by cost
- **"How many tool calls happened?"** → filter to Tool, see count
- **Traces with many repeated spans** (77 "Scenario Turn" instances) → compare them in a table instead of scrolling a tree
- **Finding a specific span** → search by name
- **Comparing spans** → tabular format makes comparison easy

The waterfall/flame are better for: understanding execution flow, timing, parallelism.

## Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  [Waterfall]  [Flame]  [Span List]                   [↕ expand] │
├──────────────────────────────────────────────────────────────────┤
│  🔍 Filter spans...           Type: [All ▾]    5 of 5 spans    │
│                                                                  │
│  Name ↕               Type ↕  Dur ↓    Cost ↕   Tokens ↕ Model │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  llm.openai.chat      LLM    1.1s    $0.002   520→380  gpt-4o  │
│  llm.summarize        LLM    0.8s    $0.001   380→220  gpt-4o  │
│  tool.search_docs     Tool   0.3s    —        —        —       │
│  guardrail.pii_check  Guard  0.1s    $0.001   120→40   gpt-4o  │
│  agent.run            Agent  2.3s    $0.004   920→640  —       │
│  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─  │
│  Totals:                      2.3s*   $0.008   1.8K             │
│                                        * = trace duration        │
└──────────────────────────────────────────────────────────────────┘
```

## Columns

| Column | Content | Sortable | Notes |
|---|---|---|---|
| Name | Span name | ✓ (alpha) | Monospace. Full name, not truncated (table scrolls horizontally). |
| Type | Span type badge | ✓ | Colored badge: `LLM`, `Tool`, `Agent`, `RAG`, `Guard`, `Eval`, `Span` |
| Duration | Span duration | ✓ (default: desc) | `1.1s`, `340ms`, `<1ms` for 0ms spans |
| Cost | Span cost | ✓ | `$0.002`, `—` if no cost. Right-aligned, monospace. |
| Tokens | Input→Output | ✓ (by total) | `520→380`, `—` if no tokens. Only for LLM/Guardrail spans. |
| Model | Model name | ✓ | `gpt-4o`, `—` if not LLM. |
| Status | OK/Error | ✓ | Colored dot. Error sorts first. |
| Start | Offset from trace start | ✓ | `+0ms`, `+340ms`, `+1.2s`. Useful for understanding order. |

### Column Visibility

All columns shown by default. The Type and Status columns can be hidden if the user filters to a single type (e.g., all LLM → Type column is redundant).

## Filtering

### Type Filter

Dropdown at the top: `[All ▾]` → click to select one or more span types:

```
┌────────────────────┐
│  Type Filter       │
│  ☑ All             │
│  ─ ─ ─ ─ ─ ─ ─ ─  │
│  ☐ LLM      (2)   │
│  ☐ Tool     (1)   │
│  ☐ Agent    (1)   │
│  ☐ Guard    (1)   │
│  ☐ RAG      (0)   │
│  ☐ Eval     (0)   │
│  ☐ Span     (0)   │
└────────────────────┘
```

- Counts per type shown
- Types with 0 spans are greyed out but visible
- Multi-select: can check LLM + Tool to see both
- "All" unchecks individual selections

### Name Search

`🔍 Filter spans...` — text input that filters span names as you type. Filters by substring match, case-insensitive.

### Combined Filters

Filters compose: `Type: LLM` + search "chat" → shows only LLM spans with "chat" in the name.

## Span Count Display

Top-right: `5 of 5 spans` (or `2 of 5 spans` when filtered). Always shows total.

## Sorting

- Click any column header to sort. Arrow indicator (↑/↓) on active sort column.
- **Default sort:** Duration descending (slowest first)
- **Secondary sort:** When primary sort values are equal, secondary sort by start time ascending.
- Click the same column header again to toggle asc/desc.

## Footer: Aggregates

A footer row shows aggregates for the visible (filtered) spans:

```
│  Totals:                      2.3s*   $0.008   1.8K             │
│                                        * = trace duration        │
```

- **Duration:** Trace total duration (not sum of spans, since spans overlap). Asterisk + footnote: "trace duration".
- **Cost:** Sum of visible span costs.
- **Tokens:** Sum of visible span tokens (total in→out).
- When filtered: aggregates update to reflect only the filtered spans. Label changes: `Filtered totals:`.

## Duplicate Span Names

41% of traces have duplicate span names. The span list handles this naturally — each span is its own row. But to help differentiate:

- **Start time column** distinguishes same-named spans by when they ran
- **Span ID** is available on hover (tooltip) — never shown as a column (not human-useful), but used for selection/linking
- If sorted by name, same-named spans cluster together. The Start column is the differentiator.
- No artificial index numbers (e.g., "tool_search #1, #2, #3") — the data speaks for itself.

## Interaction with Sibling Groups (from Waterfall)

If the user was viewing the waterfall with a grouped siblings row ("Scenario Turn ×77") and clicked the "view in Span List" link:

- Span List opens with the name search pre-filled: `Scenario Turn`
- The Type filter is set to match the group's type
- User sees all 77 spans as sortable rows — much better for comparison than scrolling a tree

This cross-view link is the Span List's killer feature for complex traces.

## Interactions

| Action | Behavior |
|---|---|
| Click row | Select span → open span tab |
| Click column header | Sort by that column |
| Type dropdown | Filter to span type(s) |
| Search input | Filter by span name |
| Hover row | Subtle highlight, tooltip with span ID |

## Performance

| Span count | Strategy |
|---|---|
| <100 | Render all rows |
| 100-500 | Virtualize rows (render visible, recycle off-screen) |
| 500+ | Same virtualization + "Showing first 200 of N. Load more." |

The Span List is the most performant view for large traces since it's just a table with virtualization — no layout computation needed.

## Data Gating

- **Single-span trace:** One row. Shows the data. Not very useful but doesn't break.
- **No cost/tokens/model:** Show `—` in those cells. Don't hide the columns.
- **All spans filtered out:** "No spans match the current filter" with clear filter link.
- **0ms spans:** Show `<1ms` in duration column. Sortable (sorts as 0).
