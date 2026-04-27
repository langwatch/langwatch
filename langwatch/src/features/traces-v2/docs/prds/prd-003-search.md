# PRD-003: Search & Filter System

Parent: [Design: Trace v2](../design/trace-v2.md)
Status: DRAFT
Date: 2026-04-22

## What This Is

The search and filtering system for traces. Two components that stay in sync: a search/query bar spanning the full width at the top, and a filter column on the left with faceted controls.

## Layout

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [LangWatch]  Observe  Live Tail                                             │
├──────────────────────────────────────────────────────────────────────────────┤
│ 🔍 @status:error AND @model:gpt-4o  "refund policy"          [Clear all]   │
├────────────┬─────────────────────────────────────────────────────────────────┤
│  FILTERS   │                                                                │
│            │  (trace table)                                                 │
│ ORIGIN     │                                                                │
│  ☐ App  15 │                                                                │
│  ☐ Sim   8 │                                                                │
│  ☐ Eval  3 │                                                                │
│            │                                                                │
│ STATUS     │                                                                │
│  ● Error 3 │                                                                │
│  ● Warn  2 │                                                                │
│  ● OK  15  │                                                                │
│            │                                                                │
│ SPAN TYPE  │                                                                │
│  ☑ Agent 8 │                                                                │
│  ☐ LLM   5 │                                                                │
│  ☐ RAG   4 │                                                                │
│  ☐ Tool  3 │                                                                │
│            │                                                                │
│ MODEL      │                                                                │
│  ☑ gpt-4o  │                                                                │
│  ☐ claude  │                                                                │
│  ☐ gpt-5m  │                                                                │
│            │                                                                │
│ SERVICE    │                                                                │
│  ☐ finance │                                                                │
│  ☐ support │                                                                │
│  ☐ research│                                                                │
│            │                                                                │
│ ─ ─ ─ ─ ─ │                                                                │
│ TOKENS     │                                                                │
│ ○────────○ │                                                                │
│ 0    100K  │                                                                │
│            │                                                                │
│ COST       │                                                                │
│ ○────────○ │                                                                │
│ $0   $2.00 │                                                                │
│            │                                                                │
│ LATENCY    │                                                                │
│ ○────────○ │                                                                │
│ 0s    60s  │                                                                │
│            │                                                                │
└────────────┴─────────────────────────────────────────────────────────────────┘
```

## Time Range Selector

The time range picker sits in the **toolbar strip** (between the grouping selector and density toggle), not in the search bar. This keeps the search bar focused purely on query input.

```
┌──────────────────────────────────────────────────────────────────┐
│ 🔍 @status:error AND @model:gpt-4o                     [Clear]  │
├──────────────────────────────────────────────────────────────────┤
│ All Traces │ Errors │ ... │ Group: flat ▾ │ ⏱ Last 24h ▾ │ ≡≡ │
└──────────────────────────────────────────────────────────────────┘
```

### Presets

| Label | Range |
|---|---|
| Last 15 min | Now - 15 minutes |
| Last 1 hour | Now - 1 hour |
| Last 6 hours | Now - 6 hours |
| Last 24 hours | Now - 24 hours (default) |
| Last 7 days | Now - 7 days |
| Last 30 days | Now - 30 days |
| Custom | Date/time picker for start and end |

- **Default:** Last 24 hours
- **Custom range:** Opens a date/time picker popover with start and end fields. Relative (e.g., "last 3 hours") and absolute (e.g., "Apr 20 14:00 — Apr 21 14:00") both supported.
- **URL param:** `?from=now-1h&to=now` or `?from=2026-04-20T14:00:00Z&to=2026-04-21T14:00:00Z`
- **Persisted:** Last-used range stored in localStorage, restored on page load.
- The time range applies to the Observe page only. Live Tail is always "now" and doesn't use this selector.

## Search Bar (top, full width)

### Behavior

- Single input field spanning the full width below the nav bar, to the left of the time range selector
- Placeholder text: `Filter traces... @status:error AND @model:gpt-4 OR "timeout"`
- Shows the current active query in structured syntax
- Supports typing, paste, and autocomplete

### Query Syntax (Formal Grammar)

The query language is intentionally simple — no nested parentheses, no complex boolean trees. This keeps the two-way sync between search bar and filter sidebar implementable.

```
query       = clause ((" AND " | " OR ") clause)*
clause      = "NOT "? (field_expr | text_expr | grouped)
grouped     = "(" clause ((" AND " | " OR ") clause)* ")"
field_expr  = "@" field_name ":" value
text_expr   = '"' [^"]+ '"'
field_name  = [a-z_]+
value       = range | csv_values | glob
range       = number ".." number | (">" | "<") number
csv_values  = value_token ("," value_token)*
glob        = value_token "*"?
value_token = [^\s,)"]+
```

**Constraints:**
- Max one level of parentheses (no nesting). `(A OR B) AND C` is valid. `((A OR B) AND C) OR D` is not.
- Unquoted text without `@` prefix is treated as free text search.
- The parser must be deterministic so the two-way sync can round-trip: parse → AST → serialize → same string.

**Examples:**
```
@field:value              Exact match on a field
@field:value*             Partial/prefix match
"free text"               Full-text search across trace I/O content
NOT @field:value          Negation
@field:value1,value2      OR within same field (shorthand)
expr1 AND expr2           Both conditions must match
expr1 OR expr2            Either condition matches
(expr1 OR expr2) AND expr3  Grouping (one level only)
```

### Supported Fields

| Field | Values | Notes |
|---|---|---|
| `@origin` | `application`, `simulation`, `evaluation` | Synced with Origin facet in sidebar |
| `@status` | `error`, `warning`, `ok` | |
| `@model` | Any model name | Partial: `@model:gpt*` matches all GPT models |
| `@service` | Any service name | Partial supported |
| `@type` | `llm`, `tool`, `agent`, `rag`, `chain`, `module`, `evaluation`, `guardrail` | Span type (from `langwatch.span.type`) |
| `@user` | User ID | |
| `@conversation` | Conversation ID (ThreadId in data) | |
| `@cost` | `>0.01`, `<1.00`, `0.01..1.00` | Range syntax |
| `@duration` | `>1s`, `<500ms`, `1s..5s` | Range with units |
| `@tokens` | `>1000`, `<100` | Range |
| `@has` | `error`, `eval`, `feedback`, `annotation`, `conversation` | Existence checks |
| `@event` | Any event type name | Filter by event type: `@event:user.feedback`, `@event:guardrail.pass` |
| `@eval` | Any eval name | Filter by eval: `@eval:faithfulness`, `@eval:toxicity` |
| `@trace` | Trace ID | Exact match: `@trace:a3f8c2d1...` |

### Autocomplete

When the user types `@`, show a dropdown of available field names. When they type `@field:`, show a dropdown of known values for that field (populated from the data).

```
┌─────────────────────────────────────┐
│ 🔍 @mo|                            │
│  ┌──────────────┐                   │
│  │ @model       │                   │
│  │   gpt-4o     │                   │
│  │   claude-son │                   │
│  │   gpt-5-mini │                   │
│  └──────────────┘                   │
└─────────────────────────────────────┘
```

Free text (unquoted) that doesn't match a field prefix is treated as a full-text search across trace input/output content.

### Keyboard

- `/` focuses the search bar from anywhere on the page
- `Escape` clears focus (returns to table)
- `Enter` applies the query
- Up/Down arrows navigate autocomplete suggestions
- `Tab` accepts the current autocomplete suggestion

## Filter Column (left sidebar)

### Structure

The filter column is a scrollable sidebar. It contains categorical facets (checkboxes) and range facets (sliders). Each facet shows the count of matching traces next to each value.

### Categorical Facets

**Three-stage negation checkboxes:** Each facet value has a three-state checkbox that cycles through: neutral (not filtering) -> include (show only matching) -> exclude (show everything BUT matching) -> neutral.

- **Neutral:** Unchecked checkbox, muted text
- **Include:** Checked checkbox (blue), white text — maps to `@field:value` in production query
- **Exclude:** Indeterminate checkbox (red), white text — maps to `NOT @field:value` in production query

**Data model:** Each facet stores `FilterValue<T> { include: T[]; exclude: T[] }` instead of a simple array. Evaluation rules:
- If any values are in `include`: whitelist mode (only show matching traces)
- If any values are in `exclude` (none in include): blacklist mode (show all except those)
- If both include and exclude: include first, then subtract exclude
- If all neutral: no filtering on this facet

**Lens-locked filter interaction:** Lens-locked filters (e.g., Errors lens locks status:error) disable negation. The checkbox is locked to include-only, matching the lock behavior for the entire section.

**Always visible (standard facets):**
- **Status:** Error, Warning, OK — with count badges
- **Trace Type:** Agent, LLM, RAG, Tool, Chain, Guardrail — with count badges
- **Model:** Dynamic list from data — with count badges
- **Service:** Dynamic list from data — with count badges
- **User:** Dynamic list from data (if available)
- **Labels:** Dynamic list from data (if available)

**Origin-specific facets (shown when an origin is selected):**
- **Simulation origin:** adds Scenario facet (list of scenario names), Verdict facet (Pass/Fail)
- **Evaluation origin:** adds Eval Type facet (list of eval types), Score Range slider
- **Application origin:** no additional facets (standard set is sufficient)
- These are additive — standard facets always remain visible alongside origin-specific ones

Each is a section with a heading and checkboxes. Checking a box:
1. Immediately filters the table
2. Updates the search bar to reflect the new filter (e.g., checking "Error" adds `@status:error` to the query)

### Filter Item Row Layout

Every filter item follows the same layout, regardless of section:

```
[checkbox] [color dot] label text...  count
```

- **Checkbox:** Always on the left. Consistent across all sections.
- **Color dot:** Optional. Present for Origin (blue/purple/orange), Status (red/yellow/green), and Span Type (type-specific colors). Not present for Service, Model, User, Labels.
- **Label text:** Single line, text-overflow ellipsis for long values. `flex: 1` fills available space. Mono font for Service and Model (technical identifiers). Standard font for Origin, Status, Span Type (human-readable categories).
- **Count:** Right-aligned, mono font, muted color. Shows trace count for this value.
- **Row click target:** The entire row is clickable (not just the checkbox).

Multiple selections within the same facet = OR. Selections across facets = AND.

Example: checking Error + Warning under Status, and gpt-4o under Model:
- Query: `(@status:error OR @status:warning) AND @model:gpt-4o`

### Range Facets

- **Tokens:** Double-handled slider, 0 to max observed value
- **Cost:** Double-handled slider, $0 to max observed value
- **Latency:** Double-handled slider, 0s to max observed value

Adjusting a slider:
1. Immediately filters the table
2. Updates the search bar (e.g., `@cost:0.01..1.00`)

### Counts Update

When any filter is applied, the count badges on ALL other facets update to reflect the filtered dataset. This shows the user how many results they'd get if they added another filter.

### Collapse/Expand

- Each facet section is collapsible (click the heading to toggle)
- The entire filter column can be collapsed via a `«` chevron button (top-right of sidebar). Collapsed state: 40px wide strip with section abbreviations (O, S, T, Sv, M, Tk, $, Lt). Expand via `»` chevron or by clicking any section abbreviation.
- **Keyboard shortcut:** `[` toggles sidebar collapse (when not focused on a text input)
- **Active filter dots:** In collapsed state, sections with active filters show a colored dot: blue for include filters, red if any exclude filters active (red takes priority)
- Collapsed state persisted in localStorage (`langwatch:sidebar-collapsed`)

### Filter Chip Bar

When the sidebar is collapsed AND at least one filter is active, a horizontal chip bar appears between the toolbar and table.

- **Chips:** Each active filter value as a chip: `{Section}: {value}` with include (blue) or exclude (red) indicator
- **Dismiss:** Each chip has an × button to clear that specific filter
- **Clear all:** Button on the right side clears all filters
- **Click:** Clicking a chip (not the ×) expands the sidebar
- **Overflow:** Horizontal scroll, single row, ~32px height
- **Visibility:** Hidden when sidebar is expanded or no filters are active

## Two-Way Sync

This is the critical behavior. The search bar and the filter column are always in sync. The source of truth is the **parsed query AST** — both the search bar text and the sidebar controls are views of the same AST.

### Core Sync Rules

1. **Checkbox → AST → Search bar:** Checking a checkbox mutates the AST (adds a clause), then the AST is serialized to the search bar text.
2. **Search bar → AST → Checkboxes:** Typing a query parses it into the AST, then the AST is projected onto sidebar controls (checkboxes checked, sliders positioned).
3. **Slider → AST → Search bar:** Moving a slider mutates the AST (adds/updates a range clause), then serialized to the search bar.
4. **Search bar → AST → Slider:** Typing `@cost:0.01..1.00` parses into the AST, then projected onto the cost slider.
5. **Clear all:** Resets the AST to empty, which clears both the search bar text and all sidebar controls.
6. **Free text:** Text in quotes (`"refund"`) exists in the AST as a text clause. It appears in the search bar but has no sidebar equivalent — no checkbox, no visual indicator in the sidebar.

### Round-Trip Fidelity

The parse → AST → serialize cycle must produce the **same query string** (modulo whitespace normalization). This is required for the two-way sync to feel predictable.

- `@status:error AND @model:gpt-4o` → parse → serialize → `@status:error AND @model:gpt-4o`
- Whitespace is normalized: extra spaces collapsed, consistent spacing around `AND`/`OR`
- Field order is preserved (not alphabetically sorted) — the user's mental model of "I added this first" matters
- Values within a CSV are sorted alphabetically: `@status:warning,error` → `@status:error,warning`

### Edge Cases

**Invalid query syntax in search bar:**
- The search bar shows a red outline and inline error message (see Error States).
- The sidebar does NOT update — it retains the state from the last valid query. This prevents the sidebar from flickering or showing an inconsistent state while the user is mid-edit.
- Once the user fixes the syntax and presses Enter (or the query becomes valid), the sidebar syncs to the new valid state.

**NOT expressions (updated — three-stage checkboxes):**
- `NOT @status:error` in the search bar sets the Error checkbox to `exclude` state (red indeterminate). Negation IS now visually represented in the sidebar via the three-state checkbox.
- In production, clicking a checkbox in exclude state cycles to neutral, removing the `NOT @field:value` clause from the AST.
- In the mock: three-stage checkboxes update FilterState directly (include/exclude arrays) but do not sync to the search bar text (no AST parser in the mock).

**Complex boolean queries with parentheses:**
- `(@status:error OR @status:warning) AND @model:gpt-4o` — the sidebar can represent this: Error and Warning checked under Status, gpt-4o checked under Model. Cross-facet is AND, within-facet is OR. This matches the sidebar's natural behavior.
- `@status:error OR @model:gpt-4o` — cross-facet OR. The sidebar **cannot** represent this because sidebar controls are always AND across facets. The query appears in the search bar, but the sidebar shows both Error and gpt-4o checked with no visual indication that they're OR'd. A subtle badge appears on the search bar: `⚠ Query uses cross-facet OR — sidebar may not fully reflect the query.`
- `@status:error AND (@model:gpt-4o OR @model:claude*)` — the parenthesized OR within one facet maps to multi-select in the sidebar. gpt-4o and claude* both checked under Model. This works.

**Fields with no sidebar equivalent:**
- `@user:abc123`, `@conversation:thread_xyz`, `@trace:...`, `@has:feedback`, `@event:...`, `@eval:...`, and free text (`"refund"`) all exist only in the search bar. The sidebar has no controls for these.
- These clauses are preserved in the AST and serialized to the search bar. Sidebar interactions (checking boxes, moving sliders) add/remove clauses around them but never touch them.
- When projecting the AST onto the sidebar, unknown fields are silently skipped.

**Rapid checkbox clicks (debounce):**
- Each checkbox click mutates the AST immediately and updates the search bar text immediately (no debounce on the UI update — it must feel instant).
- The **query execution** (firing the ClickHouse query) is debounced by 300ms. If the user clicks 3 checkboxes in quick succession, only one query fires after the last click.
- Optimistic UI: checkbox states update instantly. If the query fails, the checkbox reverts to its pre-click state with a brief shake animation.

**Slider drag (continuous):**
- While dragging a slider handle, the search bar text updates live (shows the current range value). This gives feedback but does not fire queries.
- Query execution fires 300ms after the user releases the slider handle (mouseup/touchend).
- If the user grabs the slider again within the 300ms window, the pending query is cancelled.

**Removing the last value from a facet:**
- If the user unchecks the last remaining checkbox in a facet (e.g., unchecking "error" when it was the only status selected), the entire `@status:...` clause is removed from the AST and search bar. The facet returns to "no filter" (all values shown).

**Search bar edit that partially matches sidebar:**
- If the user manually edits the search bar to `@status:error,warning` and presses Enter, the sidebar checks Error and Warning under Status. Other facets are unaffected.
- If the user deletes a clause from the search bar (e.g., removes `@model:gpt-4o`), the corresponding checkbox unchecks on Enter.

## AI Query (future, Phase 3)

In Phase 3, a lightweight model will sit between the user's natural language input and the query syntax. If the user types something that doesn't look like query syntax (no `@` prefix, no quotes), the system will attempt to parse it as natural language and generate the corresponding structured query.

For Phase 1: the search bar only accepts structured query syntax and free text in quotes. No NLP.

## Error States

| Scenario | Display |
|---|---|
| Malformed query syntax | Red outline on search bar. Inline message below: "Invalid query syntax — check for unmatched quotes or parentheses." Query does not execute. |
| ClickHouse query timeout | Table shows: "Query timed out. Try narrowing your filters or reducing the time range." with [Retry] button. |
| Facet count load failure | Stale counts remain visible with a subtle "outdated" badge on the facet section header. Tooltip: "Counts may be outdated. Click to refresh." |
| Autocomplete values fail to load | Autocomplete dropdown shows: "Could not load suggestions" in muted text. User can still type manually. |
| Empty autocomplete results | Autocomplete dropdown shows: "No values found for @field" |

## Performance

- **Debounce:** Filter changes (checkbox clicks, slider moves) are debounced by 300ms before triggering a query. Typing in the search bar waits for Enter (no live search while typing — only autocomplete suggestions update live).
- **Facet count approximation:** When the result set exceeds 10,000 traces, facet counts are approximate (using ClickHouse's `uniqHLL12` or sampling). Counts display with a "~" prefix: `~1.2K`. Below 10,000 traces, counts are exact.
- **Facet count batching:** All facet counts are fetched in a single query, not one per facet. This avoids N+1 aggregation queries.

## Facet Density & Scaling

### Facet Section Ordering

Facet sections appear in a fixed order. Standard facets first, then origin-specific facets (if an origin is selected), then range facets at the bottom.

**Fixed order:**
1. Origin (always first — most fundamental filter)
2. Status
3. Span Type
4. Model
5. Service
6. User (if data exists)
7. Labels (if data exists)
8. *Origin-specific facets* (Scenario, Verdict, Eval Type — see Origin filter section)
9. Tokens (range slider)
10. Cost (range slider)
11. Latency (range slider)

Dynamic facets (User, Labels) only appear when the data contains values for them. If no traces have a user ID, the User facet section is not rendered — no empty sections.

### High-Cardinality Facets (10+ values)

When a facet has more than 10 values:

```
┌──────────────┐
│ MODEL        │
│  ☑ gpt-4o  45│
│  ☐ claude  32│
│  ☐ gpt-5m  28│
│  ☐ gemini  15│
│  ☐ llama    8│
│  ☐ mistral  6│
│  ☐ cohere   4│
│  ☐ titan    3│
│  ☐ jamba    2│
│  ☐ qwen    1│
│  ▼ Show 8 more│
│              │
│  🔍 Filter...│
└──────────────┘
```

- **Top 10 by count:** Show the 10 values with the highest trace count, sorted by count descending.
- **"Show N more" expander:** Click to reveal the remaining values, also sorted by count descending. The expander text updates: `▼ Show 8 more` → `▲ Show less`.
- **Search within facet:** A small search input appears below the values when the facet has 10+ values. Type to filter the value list by substring match. The search filters the display, not the data — it's a UI convenience for finding a value in a long list.
- **Expanded state persisted:** If the user expands a facet, it stays expanded for the session (not persisted to localStorage — it resets on page reload).

### Very High-Cardinality Facets (50+ values)

For facets like Service (60 distinct values in dev data) or SpanName (5,632 values):

- **Show top 10 + search.** Do NOT render 50+ checkboxes. The "Show N more" expander shows up to 20 additional values (30 total). Beyond that, the user must use the search input to find specific values.
- **"Show all" capped at 30:** `▼ Show 20 more` expands to 30 total. If there are still more: `And 30 more — use search to filter` in muted text below.
- **Search matches against all values**, not just the visible ones. Results appear inline, replacing the top-10 list while the user is typing. Clear the search to return to the top-10 view.
- **SpanName is NOT a sidebar facet.** With 5,632 values, it's search-bar-only (`@type:...` for span type categories). The sidebar shows Span Type (15 values), not individual span names.

### Many Facet Sections (10+ sections)

With origin-specific facets, the sidebar can have 10+ sections. To prevent the sidebar from being an endless scroll:

- **All sections collapsible:** Click the section heading to collapse/expand. Collapsed sections show only the heading + count of active filters in that section: `MODEL (1 selected)`.
- **Default collapsed state:** Origin, Status, Span Type are open by default. All other sections (Model, Service, User, Labels, range sliders) are collapsed by default. Origin-specific facets (Scenario, Verdict, Eval Type) are open by default when they appear.
- **Active filter indicator:** Sections with active filters show a count badge on the heading even when collapsed. The user can see that Model has 1 filter active without expanding it.
- **Locked facets:** When a preset (Conversations, Errors) locks a facet, the section is collapsed and non-expandable. The heading shows: `🔒 [Facet]: [value] (set by [Preset])`. Hover tooltip explains: "This filter is set by the [Preset] view. Switch to All Traces to change it." Locked facets are visually distinct (muted heading, lock icon) and do not respond to click. See PRD-002 for which presets lock which facets.
- **Sticky section headers:** As the user scrolls the filter column, section headers stick to the top of the scroll area briefly (CSS `position: sticky`). This helps orientation in a long filter list.

### Zero-Count Values After Filtering

When filters are active, some facet values may have zero matching traces:

- **Zero-count values are hidden**, not greyed out. If filtering by `@model:gpt-4o` means no traces have status "Warning", the Warning option disappears from the Status facet.
- **Exception: actively checked values.** If the user has Warning checked and then applies another filter that reduces Warning's count to zero, Warning stays visible with count `0` and remains checked. This prevents the user's own selection from vanishing — they need to see it to uncheck it.
- **Re-appearance:** When filters are cleared, hidden values reappear with their updated counts.

### Facet Count Display

- **Exact counts below 10,000:** Show the exact number: `45`, `1,230`.
- **Approximate counts above 10,000:** Show with `~` prefix: `~12.3K`, `~1.2M`. Tooltip: "Approximate count (>10K results)".
- **Count formatting:** Numbers ≥1,000 use K suffix: `1.2K`. Numbers ≥1,000,000 use M suffix: `1.2M`. Below 1,000: raw number.
- **Count alignment:** All counts are right-aligned within the facet section for visual consistency.

## Data Gating

- Facet values are populated from the actual data (not hardcoded). If a service doesn't exist in the data, it doesn't appear in the filter.
- Facets with only one value are still shown (useful to know that all traces are from one service).
- If a facet has more than 10 values, show the top 10 by count with "Show N more" expander (see Facet Density above).
- Range slider min/max are derived from the actual data range.
- If no data exists for a range facet (e.g., no traces have cost data), the slider is hidden entirely.
