# PRD-019: Grouping Engine

Parent: [Design: Trace v2](../design/trace-v2.md)
Extends: [PRD-002: Trace Table](prd-002-trace-table.md)
Phase: 2 (Lens Engine)
Status: DRAFT
Date: 2026-04-23

## What This Is

A generalized grouping engine that transforms the flat trace table into accordion-grouped sections by any dimension (session, service, user, model). Phase 1's Conversations preset is a hardcoded grouped lens. Phase 2 generalizes this pattern so any lens can group by any supported dimension, and users can switch grouping on the fly.

## Grouping Selector

A dropdown in the toolbar, to the right of the lens tabs:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [All Traces] [Conversations] [Errors] [By Model] [My Lens]                 │
│                                                [Group: flat ▾] [+]         │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Dropdown Options

```
┌────────────────────────┐
│  Grouping              │
│                        │
│  ○ Flat (no grouping)  │   ← default for All Traces, Errors
│  ○ By Session          │   ← groups by conversation/thread ID
│  ○ By Service          │   ← groups by service name
│  ○ By User             │   ← groups by user ID
│  ○ By Model            │   ← groups by primary model name
└────────────────────────┘
```

- **Selecting a grouping:** Immediately transforms the table. Lens enters draft state (PRD-017).
- **Label updates:** The dropdown label shows the active grouping: `Group: by model ▾`
- **"Flat" = no grouping.** The table renders as a flat list of traces (Phase 1 default behavior).

### Interaction with Built-in Grouped Lenses

Built-in lenses that have a fixed grouping dimension **lock** the grouping selector:

| Lens | Locked Grouping | Selector State |
|------|----------------|----------------|
| All Traces | — | Enabled, default: flat |
| Conversations | by-session | **Disabled** (greyed out) |
| Errors | — | Enabled, default: flat |
| By Model | by-model | **Disabled** (greyed out) |
| By Service | by-service | **Disabled** (greyed out) |
| By User | by-user | **Disabled** (greyed out) |
| Custom lenses | — | Enabled, shows saved grouping |

When the grouping selector is disabled:
- The dropdown shows the locked value: `Group: by model 🔒`
- Clicking the dropdown does nothing (or shows a tooltip: "Grouping is fixed for this lens. Create a custom lens to change it.")
- The lock icon matches the lock pattern used for locked facets in PRD-003

### Changing Grouping on a Built-in Lens

You can't change the grouping on a locked built-in lens directly. The intended flow:
1. Go to "All Traces" (grouping unlocked)
2. Select the grouping you want
3. Optionally adjust columns
4. "Save as new lens" to create a custom lens with your preferred grouping

This keeps built-in lenses predictable while giving full flexibility through custom lenses.

## Accordion Group Rendering

When grouping is active (anything other than "flat"), the table renders as collapsible accordion sections. This generalizes the Conversations preset pattern from PRD-002.

### Group Header Row (column-aligned aggregates)

Group header rows use the SAME column grid as trace rows. Each column shows an aggregate value computed from the group's traces. This makes scanning groups as easy as scanning a flat table.

```
┌──────┬──────────────────────┬─────────┬──────────┬──────┬──────┬────────┬──────┐
│ Time │ Trace                │ Service │ Duration │ Cost │ Tok  │ Model  │ Stat │
├──────┼──────────────────────┼─────────┼──────────┼──────┼──────┼────────┼──────┤
│ 2m   │ ▶ gpt-4o       (45) │ mixed   │ avg 1.2s │$0.34 │18.2K │ gpt-4o │ 3 ⚠ │
│ 15m  │ ▶ claude-son    (32) │ mixed   │ avg 0.8s │$0.21 │12.1K │ claude │     │
│ 1h   │ ▶ gpt-5-mini   (18) │ mixed   │ avg 0.3s │$0.04 │ 2.4K │ 5-mini │     │
│ 5m   │ ▼ llama-70b      (8) │ research│ avg 2.1s │$0.00 │ 8.8K │ llama  │ 1 ⚠ │
│      ├──────────────────────┼─────────┼──────────┼──────┼──────┼────────┼──────┤
│ 5m   │   agent.run          │ research│ 1.2s     │$0.00 │ 1.2K │ llama  │ ●   │
│ 8m   │   rag.retrieve       │ research│ 3.4s     │$0.00 │ 3.4K │ llama  │ ●   │
│ ...  │                      │         │          │      │      │        │     │
│ 3h   │ ▶ gemini-pro     (5) │ support │ avg 0.6s │$0.02 │ 1.1K │ gemini │     │
└──────┴──────────────────────┴─────────┴──────────┴──────┴──────┴────────┴──────┘
```

### Column Aggregate Functions

Each column type has one automatic aggregate function. No user configuration needed.

| Column | Aggregate | Format | Prefix |
|--------|-----------|--------|--------|
| Time | Most recent trace timestamp | Relative ("2m") | none |
| Trace | ▶/▼ toggle + group key + "(N)" count | `▶ gpt-4o (45)` | none |
| Service | Most common service in the group | Full name, or "mixed" if 3+ distinct | none |
| Duration | **Average** across all traces | "1.2s" | "avg " |
| Cost | **Sum** across all traces | "$0.34" | none |
| Tokens | **Sum** across all traces | "18.2K" | none |
| Tokens In | **Sum** | "9.1K" | none |
| Tokens Out | **Sum** | "9.1K" | none |
| Model | Most common model (or group key if grouped by model) | Truncated name | none |
| Status | Error count if >0, otherwise green dot | "3 ⚠" in red, or "●" green | none |
| TTFT | **Average** | "340ms" | "avg " |
| Eval scores | **Average** across all traces with that eval | "● 7.2" | "avg " |
| Events | **Sum** of event counts | "12" | none |
| User ID | Most common user (or group key if grouped by user) | Truncated ID | none |
| Span count | **Average** | "3.2" | "avg " |

**Prefix rules:**
- **"avg " prefix** on: Duration, TTFT, Eval scores, Span count. These are averages and the user needs to know they're not looking at a single trace value.
- **No prefix** on: Cost, Tokens, Events (obviously totals when you see "45 traces"), Time, Service, Model, Status (not aggregatable in the same way).

**Categorical aggregates (string columns like Service, Model, User):**
- If all traces in the group share the same value: show that value (e.g., Service = "finance")
- If 2+ distinct values: show the count of variants: `×3` (using the multiplication sign). Muted text. Hover tooltip lists the distinct values.
- If the column IS the grouping dimension (e.g., Model column when grouped By Model): show the group key (redundant but consistent, keeps the column grid populated)

**Time column aggregate:**
- Show the time range of the group: `2m .. 1h` (most recent .. oldest trace, relative timestamps). This tells you both when the group was last active and how spread out the traces are.
- If all traces have the same timestamp (rare): show that single timestamp

**Group key column (Trace column):**
- Shows the expand/collapse toggle (▶/▼)
- Group key value in bold
- Trace count in parentheses "(45)" in muted text, right next to the group key

### Group Header Styling

- **Background:** Subtle tint to distinguish from trace rows (`gray.50` in light mode, `gray.800` in dark mode)
- **Text weight:** Group key is bold. Aggregate values are normal weight.
- **Conditional formatting applies** to group header aggregates (PRD-020). If the group's avg duration exceeds a threshold, the Duration cell gets the colored background.
- **Headers are sticky** within their scroll context (if the expanded group is long, the header stays visible at the top)
- **Hover:** Group header rows have the same hover background as trace rows. Clicking anywhere on the row toggles expand/collapse.

### Aggregate Stats for Session Grouping (Conversations)

The "By Session" grouping (Conversations lens) uses specialized aggregates that differ from the standard column aggregates:

| Column | Session Aggregate | Format |
|--------|------------------|--------|
| Trace | ▶/▼ + conversation ID + "(N turns)" | `▶ abc12345 (6 turns)` |
| Duration | Wall-clock span (first to last trace) | "wall: 8m 12s" |
| Cost | Sum | "$0.008" |
| Status | Worst status across turns | Error dot or OK |

Session grouping retains the Conversations preset's richer display (PRD-002): the second line with message counts (👤3 🤖3 🔧4), model, service. This is an exception to the standard column-aligned pattern. Session group headers get TWO lines: the column-aligned aggregate row plus a summary sub-row.

### Expand/Collapse Behavior

- **Default:** All groups collapsed. User clicks to expand.
- **Click group header:** Toggles expand/collapse for that group.
- **Expanded group:** Shows the trace rows inside, with the standard table column headers and all Phase 1 row behavior (click to open drawer, hover states, two-zone rows, etc.).
- **Multiple groups can be open simultaneously.**
- **Expand all / Collapse all:** Small buttons in the toolbar (to the right of the grouping selector): `[↕ Expand all]` `[↕ Collapse all]`. Only visible when grouping is active.

### Group Sort Order

Groups are sorted by trace count descending (busiest group first). Within each group, traces are sorted by the lens's sort column (default: time descending).

Future: allow sorting groups by other stats (cost, duration, error rate). Not Phase 2.

### Empty Groups

- Groups with 0 traces (after filtering) are hidden entirely.
- If all groups are empty after filtering: "No traces match the current filters" (same empty state as flat mode).

## Conversations Preset Refactoring

Phase 1's Conversations preset (PRD-002) has its own custom rendering for grouped conversations. Phase 2 refactors this to use the generalized grouping engine with `grouping: 'by-session'`.

### What Changes

- **Before (Phase 1):** Conversations preset has custom collapsed/expanded row rendering, custom aggregate stats (turns, wall-clock duration, message counts), custom expand behavior.
- **After (Phase 2):** Conversations preset is a built-in LensConfig with `grouping: 'by-session'` and custom column set. The grouping engine handles accordion rendering. Conversation-specific rendering (turn structure, message counts, time-between) is retained as the "by-session" group header template.

### What Stays the Same

The Conversations preset's UX is unchanged from the user's perspective:
- Collapsed row shows conversation summary (PRD-002: conversation ID, last message, turns, duration, cost, status)
- Expanded view shows turn rows (PRD-002: T1, T2, etc. with user/assistant messages)
- Conversation-specific aggregate stats in the header (turn count, wall-clock span, message counts)

The refactoring is internal. The rendering templates for "by-session" groups are specialized (richer than "by-model" or "by-service" groups), but they plug into the same accordion engine.

## Interaction with Filters

- **Filters apply within groups.** If you filter by `@status:error` on a "By Model" grouping, each group shows only its error traces. Groups with no matching traces disappear.
- **Facet counts reflect grouped data.** Facet counts in the sidebar still show trace-level counts (not group counts).
- **Group counts update when filters change.** The "45 traces" in a group header updates to reflect the filtered set.

## Interaction with Pagination

- **Pagination is per-lens, not per-group.** The page shows N groups with their traces. If a group has 100 traces and the page size is 50, the group shows "50 of 100 traces" with a "Show more" link inside the group.
- **Show more (within group):** Loads the next 50 traces for that group inline. Not a page change.
- **Page navigation:** Moves to the next set of groups. Groups are paginated, not traces within groups.

## Performance

- **Group aggregates:** Computed server-side (ClickHouse GROUP BY). The frontend does not aggregate trace rows client-side.
- **Lazy expansion:** When a group is collapsed, its trace rows are NOT fetched. Expanding a group triggers a query for that group's traces. This keeps the initial page load fast even with many groups.
- **Virtualization:** If a group has 100+ traces expanded, virtualize the rows within the group (same approach as Phase 1 flat table).

## Data Gating

- **Grouping dimension has no data:** If no traces have a user ID and the user selects "By User," show: "No user data found. Traces appear here when they include a user ID (`langwatch.user.id` attribute)."
- **Single-value dimension:** If all traces have the same service name, "By Service" shows one group. That's fine. It still shows the aggregate stats.
- **High cardinality:** If grouping by model produces 50+ groups, show the top 20 by trace count. "And 30 more groups" with a "Show all" link. Same pattern as high-cardinality facets (PRD-003).

## Future: Split/Comparison Mode

Phase 4+ will add a split mode showing two lenses side by side. The grouping engine should support rendering in a half-width container. No Phase 2 work needed, but the group header layout should use percentage-based or flex widths (not fixed px) so it adapts to narrower containers.

This is mentioned here as an architectural note, not a Phase 2 requirement. See the CEO plan (2026-04-23) for the full deferred item description.

## Keyboard

- **Enter on group header:** Expand/collapse the group
- **Up/Down arrows:** Navigate between group headers (when collapsed) or trace rows (when expanded)
- **Left arrow on expanded group header:** Collapse the group
- **Right arrow on collapsed group header:** Expand the group
