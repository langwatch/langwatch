# ADR-001: Visualization Types — Waterfall, Flame Graph, Span List

Status: ACCEPTED
Date: 2026-04-22
Relates to: `specs/traces-v2/visualizations.feature`, `flame-graph.feature`, `span-list.feature`

## Context

We need to decide which visualizations to offer in the trace drawer for viewing span data. The existing draft had three views — Tree, Waterfall, and Flame — but they were too similar. The Tree was a collapsible hierarchy with small inline timing bars. The Waterfall was horizontal timing bars with indentation. The Flame was essentially the Waterfall with labels moved to the left. All three showed hierarchy + timing with minor layout differences.

We also analyzed our ClickHouse span data to understand the actual shape of traces in production, which directly informed the decision.

## Data Analysis (ClickHouse, 2026-04-22)

Queried `langwatch.stored_spans` (177,212 spans across 54,395 traces) and `langwatch.trace_summaries` (70,721 traces).

### Span Count Distribution

| Bucket | Trace Count | % |
|---|---|---|
| 1 span | 23,840 | 43.8% |
| 2-5 spans | 19,282 | 35.5% |
| 6-10 spans | 9,550 | 17.6% |
| 11-20 spans | 1,547 | 2.8% |
| 21-50 spans | 144 | 0.3% |
| 51-100 spans | 15 | 0.03% |
| 101-200 spans | 15 | 0.03% |
| 200+ spans | 3 | 0.01% |

Summary stats: avg=2.9, median=1, P90=5, P95=6, P99=14, max=439.

**Implication:** 79% of traces have ≤5 spans. The UI must feel clean and fast for the common case. Complex traces (50+) exist but are rare — they need to work, but shouldn't drive the primary design.

### Nesting Depth

Analyzed the largest trace (299 spans): max depth was 5 levels. Structure: root → 76 children → 151 grandchildren → 66 great-grandchildren → 3 at level 5.

**Implication:** Traces are shallow, not deep like CPU call stacks (20+ levels). Deep-tree handling (collapsing at depth 10+) is not a concern. The issue is width (many siblings), not depth.

### Complex Trace Shape

Examined 3 traces with 50+ spans. All shared the same pattern: **flat-wide, not deeply nested**. Example: a scenario simulation trace with 77 "Scenario Turn" spans as siblings under one parent, each with 2-3 children.

Top span names in the largest trace:

| Span Name | Count |
|---|---|
| Scenario Turn | 77 |
| RedTeamAgent.call | 52 |
| red_team.call | 47 |
| StubDefensiveAgent.call | 25 |

**Implication:** Complex traces are repetitive loops/iterations, not deep chains. The most important optimization is **sibling grouping** — collapsing 77 identical siblings into "Scenario Turn ×77" — not deep-tree collapsing.

### Duplicate Span Names

| Has duplicates? | Trace Count | % |
|---|---|---|
| All unique names | 32,057 | 58.9% |
| Has duplicate names | 22,339 | 41.1% |

Among traces with duplicates, most (19,983) have a max of 2 repetitions of one name. But 107 traces have 10+ repetitions, and 5 traces have 100+ repetitions of a single name.

**Implication:** 41% of traces have at least one span name appearing multiple times. Visualizations must differentiate same-named spans (by position, timing, or index). A flat sortable table (Span List) is the best way to compare many instances of the same span.

### Duration Distribution

| Bucket | Span Count | % |
|---|---|---|
| 0ms (zero) | 11,269 | 6.4% |
| 1-10ms | 13,684 | 7.7% |
| 11-100ms | 49,531 | 28.0% |
| 101ms-1s | 45,863 | 25.9% |
| 1-5s | 24,580 | 13.9% |
| 5-30s | 17,863 | 10.1% |
| 30s+ | 14,422 | 8.1% |

**Implication:** The distribution is bimodal — lots of very fast spans (<10ms) AND a long tail of 30s+ spans. A linear time scale on the waterfall will either make short spans invisible or waste space on long ones. Solutions: zoom/pan on the waterfall, and click-to-zoom on the flame graph (which naturally rescales the time axis to the zoomed span's duration).

### Multi-Root Traces

- 33% of traces have 2+ root spans (18,092 with 2, 813 with 3+)
- 7.2% of traces (3,901) are fully orphaned — every span references a parent that doesn't exist in the trace

**Implication:** The viewer must handle forests (multiple root spans), not assume a single tree. Orphaned spans need a fallback (show at root level with indicator).

### Span Types

| Type | Count | % |
|---|---|---|
| LLM | 63,054 | 36% |
| Tool | 18,788 | 11% |
| Generic span | 18,302 | 10% |
| Evaluation | 15,076 | 9% |
| Chain | 13,140 | 7% |
| Agent | 12,332 | 7% |
| Module | 11,473 | 6% |
| RAG | 5,941 | 3% |
| Other | 4,889 | 3% |

**Implication:** LLM spans dominate. Type-based filtering (in Span List) and color coding (in all views) are essential. The type filter dropdown should show counts.

## Decision

Replace the three similar views (Tree, Waterfall, Flame) with three genuinely different views:

### 1. Waterfall (default)

Combines the old Tree and Waterfall into one view. Left side: collapsible tree with span names, type icons, metrics. Right side: horizontal timing bars on a time axis.

**Why it's the default:** It serves 80% of use cases — understanding execution flow, parent-child relationships, and timing. Most traces (79%) have ≤5 spans where this view is ideal.

**Key features driven by data:**
- Sibling grouping when >5 siblings share a name (handles the 77 "Scenario Turn" problem)
- Multi-root rendering (forest, not single tree)
- Zoom/pan on time axis (handles bimodal duration)
- 0ms spans as thin vertical lines (6.4% of spans)
- Orphaned spans at root level with indicator

### 2. Flame Graph

Stacked blocks, parent on top, children below. Width proportional to duration.

**Why it exists:** Click-to-zoom solves the "deep complex trace" problem. Click an agent span → it becomes full width → its children are clearly visible. The waterfall gets overwhelming at 50+ spans; the flame graph lets you drill into one branch.

**Why it's separate from waterfall:** The interaction model is fundamentally different. Waterfall is navigate-and-expand (tree paradigm). Flame graph is zoom-and-drill (map paradigm). They serve different mental models.

**Key features driven by data:**
- Click-to-zoom with breadcrumb navigation
- Sibling grouping (same threshold as waterfall)
- Zoom naturally solves the bimodal duration problem (time axis rescales)
- Minimum-width blocks for 0ms spans

### 3. Span List

Flat sortable table. No hierarchy, no timeline.

**Why it exists:** For analytical questions ("which span was slowest?", "how much did LLM calls cost?") a sortable table is better than any graph. Also the best view for comparing repeated spans — 77 "Scenario Turn" instances are much easier to compare in a sorted table than scrolling a tree.

**Why it's separate from waterfall:** No hierarchy, no timeline. Completely different paradigm — data table vs. visualization. The cross-view link (waterfall sibling group → Span List pre-filtered) is a key workflow.

**Key features driven by data:**
- Sort by any column (duration, cost, tokens, model)
- Filter by span type with counts
- Name search for finding specific spans
- Footer aggregates (sum of cost/tokens)
- Handles duplicate span names naturally (each is its own row, differentiated by start time)

## Alternatives Considered

### Keep Tree + Waterfall + Flame (original three)
Rejected: too similar. Tree and Waterfall both show hierarchy + timing. The Flame view as originally spec'd was just the Waterfall with labels on the left. Users wouldn't know which to use.

### Only Waterfall
Rejected: doesn't serve the "find the slowest span" or "compare 77 instances" use cases. Also doesn't handle deep/complex traces well (gets overwhelming).

### Waterfall + Span List (drop Flame)
Considered: viable for Phase 1. The Flame Graph's click-to-zoom is valuable for complex agent traces, but those are rare (0.06% of traces have 50+ spans). However, as agent traces become more common (the product direction), the Flame Graph becomes more important. Including it from the start avoids a later retrofit.

### DAG / Node Graph (like Langfuse)
Considered but deferred. Langfuse offers a node graph showing logical flow, which is good for understanding parallel branches and loops. This could be a future fourth view, but the three chosen views cover the core use cases. DAGs also require layout algorithms that add complexity.

## Consequences

- **Three genuinely different views** that serve distinct purposes — users have a clear reason to switch
- **Waterfall is the default** — optimized for the 79% of traces with ≤5 spans
- **Sibling grouping** is essential across waterfall and flame — driven by the data showing complex traces are flat-wide with repetitive siblings
- **Span List cross-link** from waterfall sibling groups enables a smooth workflow for analyzing repeated spans
- **Shared behavior** (colors, selection, hover, edge cases) is documented in `specs/traces-v2/visualizations.feature` and referenced by `flame-graph.feature` and `span-list.feature`
