# Facet & Filter Language: Current State

Date: 2026-04-24

## Overview

The traces-v2 filter system has two coordinated surfaces: a **text-based search bar** (Lucene-like query language) and a **faceted filter sidebar** (checkboxes + range sliders). Both are views of a single parsed AST, kept in a Zustand store. The backend translates the query into parameterized ClickHouse WHERE clauses.

The system is largely complete and production-ready. This document captures what exists, what's wired up, and what gaps remain.

---

## Architecture

```
SearchBar (TipTap)
        \
         +--> queryParser.parse() --> Zustand filterStore (AST = source of truth)
        /                                     |
FilterSidebar                                 |
  (checkboxes, sliders)              debouncedQueryText
                                              |
                                     tRPC tracesV2 router
                                              |
                                   translateFilterToClickHouse()
                                              |
                                   TraceListService
                                              |
                                   TraceListRepository (ClickHouse)
```

### Key files

| Layer | File | Role |
|-------|------|------|
| **Frontend** | `features/traces-v2/utils/queryParser.ts` | Liqe parser wrapper, AST walking, facet toggle/range mutation |
| **Frontend** | `features/traces-v2/stores/filterStore.ts` | Zustand store: AST, queryText, debounced state, all mutation methods |
| **Frontend** | `features/traces-v2/components/SearchBar/SearchBar.tsx` | TipTap editor with autocomplete, syntax highlighting, keyboard shortcuts |
| **Frontend** | `features/traces-v2/components/SearchBar/filterHighlight.ts` | ProseMirror plugin: regex-based token highlighting (blue=include, red=exclude) |
| **Frontend** | `features/traces-v2/components/FilterSidebar/FilterSidebar.tsx` | Sidebar shell: reads discover() data, renders FacetSection + RangeSection |
| **Frontend** | `features/traces-v2/components/FilterSidebar/FacetSection.tsx` | Three-state checkbox rows, high-cardinality handling (top 10 + expand + search) |
| **Frontend** | `features/traces-v2/components/FilterSidebar/RangeSection.tsx` | Double-handled slider for numeric ranges |
| **Frontend** | `features/traces-v2/hooks/useTraceFacets.ts` | Hook: calls `tracesV2.discover` with debounced time range |
| **Backend** | `server/app-layer/traces/filter-to-clickhouse.ts` | Liqe AST -> parameterized ClickHouse SQL translator |
| **Backend** | `server/app-layer/traces/facet-registry.ts` | 18 facet definitions (categorical, range, dynamic_keys) |
| **Backend** | `server/app-layer/traces/trace-list.service.ts` | Service: list, facets, discover, facetValues, suggest, newCount |
| **Backend** | `server/app-layer/traces/repositories/trace-list.repository.ts` | Repository interface for ClickHouse queries |
| **Backend** | `server/app-layer/traces/errors.ts` | Domain errors: FilterParseError, FilterFieldUnknownError, etc. |
| **Backend** | `server/api/routers/tracesV2.ts` | tRPC router: 6 filter-related endpoints |

---

## Query Language

Built on [liqe](https://github.com/gajus/liqe) (Lucene-like parser). The frontend uses `@`-prefixed field names in the PRD but the actual implementation uses bare field names (no `@` prefix).

### Syntax

```
status:error                     -- exact match
status:error AND model:gpt-4o    -- boolean AND
status:error OR model:gpt-4o     -- boolean OR
NOT status:error                 -- negation
-status:error                    -- negation (shorthand)
(status:error OR status:warning) AND model:gpt-4o  -- grouping
model:gpt*                       -- wildcard (glob)
cost:>0.01                       -- comparison operators
cost:[0.01 TO 1.00]              -- range
"refund policy"                  -- free-text search (matches ComputedInput/ComputedOutput)
refund                           -- unquoted free-text
```

### Supported fields (13)

| Field | CH Column / Expression | Type | Operators |
|-------|----------------------|------|-----------|
| `status` | `if(ContainsErrorStatus = 1, 'error', ...)` | categorical | `:` |
| `origin` | `Attributes['langwatch.origin']` | categorical | `:` |
| `model` | `Models` array | categorical | `:` (exact), `:` with `*` (LIKE) |
| `service` | `Attributes['service.name']` | categorical | `:` |
| `cost` | `TotalCost` | numeric | `:`, `:>`, `:<`, `:>=`, `:<=`, range `[min TO max]` |
| `duration` | `TotalDurationMs` | numeric | same as cost |
| `tokens` | `TotalPromptTokenCount + TotalCompletionTokenCount` | numeric | same as cost |
| `user` | `Attributes['langwatch.user_id']` | string | `:` |
| `conversation` | `Attributes['gen_ai.conversation.id']` | string | `:` |
| `has` | various existence checks | existence | `:` with values: `error`, `eval`, `feedback`, `annotation`, `conversation` |
| `eval` | subquery into `evaluation_runs` | cross-table | `:` (matches EvaluatorName) |
| `event` | subquery into `stored_spans` Events | cross-table | `:` (matches event name) |
| `trace` | `TraceId` | string | `:` (exact), `:` with `*` (LIKE) |

### Safety limits

- Max 20 AST nodes per query
- Max 50 parameters per query
- Max 500 characters per value
- All values parameterized (`{param:Type}` syntax) -- no SQL injection
- TenantId isolation enforced at every query

---

## Facet Registry

18 facet definitions across 3 tables, organized in `facet-registry.ts`:

### Categorical facets (13)

| Key | Table | Expression | Notes |
|-----|-------|-----------|-------|
| `status` | trace_summaries | `if(ContainsErrorStatus...)` | Simple expression |
| `origin` | trace_summaries | `Attributes['langwatch.origin']` | Simple expression |
| `service` | trace_summaries | `Attributes['service.name']` | Simple expression |
| `model` | trace_summaries | `arrayJoin(Models)` | Simple expression |
| `user` | trace_summaries | `Attributes['langwatch.user_id']` | Simple expression |
| `conversation` | trace_summaries | `Attributes['gen_ai.conversation.id']` | Simple expression |
| `topic` | trace_summaries | `TopicId` | Simple expression |
| `subtopic` | trace_summaries | `SubTopicId` | Simple expression |
| `label` | trace_summaries | custom queryBuilder | Extracts from JSON array in `Attributes['langwatch.labels']` |
| `evaluator` | evaluation_runs | custom queryBuilder | Cross-table, shows `[type] name` labels |
| `spanType` | stored_spans | `SpanAttributes['langwatch.span.type']` | Cross-table |
| `eventType` | stored_spans | `SpanAttributes['event.type']` | Cross-table |

### Range facets (4)

| Key | Table | Expression |
|-----|-------|-----------|
| `cost` | trace_summaries | `TotalCost` |
| `duration` | trace_summaries | `TotalDurationMs` |
| `tokens` | trace_summaries | `TotalPromptTokenCount + TotalCompletionTokenCount` |
| `ttft` | trace_summaries | `TimeToFirstTokenMs` |

### Dynamic keys facets (1)

| Key | Table | Notes |
|-----|-------|-------|
| `metadataKeys` | trace_summaries | Enumerates all user metadata keys (excludes `langwatch.*`, `gen_ai.*`, `service.*`) |

---

## Frontend Components

### SearchBar

- **Tech**: TipTap rich text editor with ProseMirror plugins
- **Highlighting**: Regex-based token decoration. Include tokens get blue pill background, exclude (NOT/`-` prefixed) get red
- **Autocomplete**: TipTap Suggestion plugin. Shows field names when typing, shows known values after `field:`. Known static values for `status`, `origin`, `has`. Other fields show a generic hint
- **Keyboard**: `/` focuses from anywhere, `Enter` applies, `Escape` blurs, arrows navigate autocomplete, `Tab` accepts suggestion
- **Cross-facet OR warning**: Yellow triangle icon when query contains OR across different fields (sidebar can't represent this)
- **Error display**: Red border + inline error message below the bar when parse fails

### FilterSidebar

- **Data source**: Calls `tracesV2.discover` which runs all 18 facet definitions in parallel via `Promise.allSettled`
- **Categorical sections**: Three-state checkboxes (neutral -> include -> exclude -> neutral). Blue for include, red/indeterminate for exclude
- **High cardinality**: Shows top 10 by count, "Show N more" expands to 30, then "use search to filter". Inline search input for facets with 10+ values
- **Range sections**: Double-handled slider (Chakra SimpleSlider). Debounced 150ms after drag end. Auto-clears if handles are near min/max
- **Collapsed mode**: Single-letter abbreviations (O, S, Sv, M) with colored dots showing active include/exclude state
- **Default expansion**: First 4 categorical sections expanded, rest collapsed. All ranges expanded

### Two-way sync

The AST in `filterStore` is the single source of truth:

1. **SearchBar -> AST**: User types, presses Enter. `applyQueryText()` parses via liqe, stores AST + serialized text
2. **Sidebar -> AST**: User clicks checkbox. `toggleFacet()` serializes current query, removes/adds clause via string manipulation, re-parses
3. **AST -> SearchBar**: Effect syncs `queryText` back into TipTap editor content
4. **AST -> Sidebar**: `getFacetValueState()` walks AST to determine each checkbox's state (neutral/include/exclude)
5. **AST -> API**: `debouncedQueryText` drives tRPC calls. `translateFilterToClickHouse()` converts to SQL on the server

---

## API Endpoints

All on `tracesV2` tRPC router, all require `traces:view` permission:

| Endpoint | Input | Returns | Notes |
|----------|-------|---------|-------|
| `list` | query, timeRange, sort, page | `TraceListPage` (items + totalHits + evaluations) | Main trace listing with filter |
| `facets` | query, timeRange | `FacetCounts` (origin, status, service, model + 3 ranges) | Scoped to current filter. Only 4 categorical + 3 ranges |
| `discover` | timeRange | `FacetDescriptor[]` (all 18 facets) | Full facet catalog. NOT scoped to current filter |
| `facetValues` | timeRange, facetKey, prefix, limit, offset | `FacetValuesResult` (paginated values + counts) | Drill into a specific categorical/dynamic_keys facet |
| `suggest` | field, prefix, limit | `string[]` | Autocomplete values. Only supports: model, service, user, origin |
| `newCount` | query, timeRange, since | `{ count }` | Real-time new trace count since timestamp |

---

## What works

1. **Query language core**: All 13 fields, all operators, boolean logic, negation, grouping, wildcards, ranges, free-text
2. **Facet discovery**: All 18 facets queryable, categorical/range/dynamic_keys types, pagination + prefix search
3. **Two-way sync**: AST as source of truth, checkbox <-> search bar bidirectional updates, range slider <-> search bar
4. **Three-state checkboxes**: neutral -> include -> exclude cycling with correct visual states
5. **Search bar UX**: Syntax highlighting, autocomplete, keyboard shortcuts, cross-facet OR warning, error display
6. **High cardinality handling**: Top 10 + expand + search for facets with many values
7. **Range sliders**: Double-handled, debounced, auto-clear at extremes, live text update during drag
8. **Collapsed sidebar**: Compact view with active filter indicators
9. **Backend safety**: Parameterized queries, tenant isolation, complexity limits, domain errors

---

## Gaps and incomplete items

### Filter language gaps

1. **No `@` prefix**: PRD specifies `@field:value` syntax but implementation uses bare `field:value`. The TipTap highlighting regex and liqe parser both work without `@`. This is a deliberate simplification but diverges from the PRD
2. **No CSV multi-value shorthand**: PRD specifies `@field:value1,value2` for OR within a field. Not implemented -- users must write `(field:value1 OR field:value2)`
3. **No duration unit parsing**: PRD specifies `@duration:>1s`, `@duration:<500ms`. The implementation only accepts raw milliseconds (`duration:>1000`). No unit conversion
4. **topic/subtopic not in filter language**: These facets exist in the registry and appear in the sidebar via `discover`, but there are no `FIELD_HANDLERS` entries for them. You can see them but can't type `topic:xyz` in the search bar
5. **label not in filter language**: Same situation -- discoverable as a facet but no handler to type `label:xyz` in the search bar
6. **metadataKeys not in filter language**: The dynamic keys facet discovers available keys but there's no way to filter by metadata key/value via the query language (e.g., `metadata.customer_tier:enterprise`)
7. **No regex support**: Liqe parses `/pattern/` but the backend treats it as a string via `extractStringValue()`

### Facet/sidebar gaps

1. **discover vs facets endpoint mismatch**: The sidebar calls `discover` (18 facets, global scope) but the `facets` endpoint (4 categorical + 3 ranges, filter-scoped) exists for re-counting after filter changes. The sidebar doesn't call `facets` -- counts don't update when filters change
2. **No filter-scoped count updates**: Per PRD "counts on ALL other facets update to reflect the filtered dataset." Currently `discover` doesn't accept a filter query, so facet counts are always global. The `facets` endpoint does accept filters but only covers 4 fields (origin, status, service, model)
3. **No range histogram**: Range facets only show min/max. No distribution visualization (PRD doesn't require one, but the slider with no histogram makes it hard to find useful ranges)
4. **evaluator/spanType/eventType not synced to search bar**: These facets appear in the sidebar via discover but have no corresponding `SEARCH_FIELDS` entries in queryParser. Clicking them doesn't update the search bar
5. **No filter chip bar**: PRD specifies a horizontal chip bar when sidebar is collapsed and filters are active. Not implemented
6. **No lens-locked filters**: PRD specifies that lens presets (Errors, Conversations) lock certain facet values. Not implemented in the sidebar
7. **No origin-specific facets**: PRD specifies that selecting an origin shows additional facets (e.g., Scenario/Verdict for simulation origin). Not implemented
8. **Facet section ordering**: PRD specifies a fixed order (Origin, Status, Span Type, Model, Service...). Currently rendered in the order returned by `discover`, which is registry order -- close but not exactly matching the PRD

### Autocomplete gaps

1. **Only static suggestions**: The `suggest` endpoint exists and queries ClickHouse for dynamic values, but the SearchBar component only uses hardcoded `FIELD_VALUES` (status, origin, has). The suggest endpoint is not wired to the autocomplete dropdown
2. **No value autocomplete for most fields**: Typing `model:` shows no model suggestions. The data is available via `suggest` but not connected
3. **No `@` trigger**: PRD specifies `@` triggers field name suggestions. The implementation triggers on any text (the Suggestion plugin matches the last word before cursor)

### Backend gaps

1. **No approximate counts**: PRD specifies `~` prefix for counts over 10,000 (using `uniqHLL12`). All counts are currently exact, which may be slow on large datasets
2. **No facet count batching**: PRD specifies all facet counts in a single query. Currently each facet runs as a separate query (discover runs 18 queries in parallel via `Promise.allSettled`)

---

## PRD divergences (intentional or unclear)

| PRD spec | Implementation | Assessment |
|----------|---------------|------------|
| `@field:value` syntax | `field:value` (no `@`) | Simpler, works well. PRD can be updated |
| `@field:val1,val2` CSV shorthand | Not implemented | Would be nice for usability but OR grouping works |
| Duration units (`>1s`, `<500ms`) | Raw milliseconds only | Should implement -- bad UX without it |
| Filter chip bar when sidebar collapsed | Not implemented | Lower priority -- sidebar collapse itself works |
| Facet counts update on filter change | Counts are global | Core gap -- users can't see how filters narrow results |
| AI query (natural language -> structured) | Phase 3, not started | Expected |

---

## Legacy Filter System

A separate, older filter system coexists in the codebase. The two systems are completely independent -- no shared state, no shared backend code.

### How it differs

| Aspect | Legacy | New (traces-v2) |
|--------|--------|-----------------|
| **State management** | `useFilterParams()` hook, URL query params via `qs` library | `useFilterStore` Zustand, in-memory AST |
| **Persistence** | URL + localStorage saved views | No URL persistence (ephemeral) |
| **UI** | `FieldsFilters.tsx` -- popover menus with searchable checklists | `FilterSidebar` -- inline facet sections with three-state checkboxes |
| **Backend** | `FilterServiceFacade` -> ClickHouse or Elasticsearch fallback | `translateFilterToClickHouse()` direct SQL generation |
| **Query model** | Structured filter objects (field + values array) | Liqe AST (text query language) |
| **Filter options API** | `analytics.dataForFilter` tRPC endpoint | `tracesV2.discover` + `tracesV2.facetValues` |
| **Fields** | 22 fields (topics, metadata, evaluations, events, annotations) | 13 fields (simpler, focused on trace-level) |

### Where each system is used

**Legacy system** -- analytics pages and annotations:
- `pages/[project]/analytics/index.tsx` (dashboard)
- `pages/[project]/analytics/reports.tsx`
- `pages/[project]/analytics/topics.tsx`
- `pages/[project]/analytics/metrics.tsx`
- `pages/[project]/analytics/users.tsx`
- `pages/[project]/analytics/evaluations.tsx`
- `pages/[project]/analytics/custom/index.tsx`
- `pages/[project]/annotations/all.tsx`

**New system** -- traces page only:
- `pages/[project]/traces.tsx` -> `features/traces-v2/components/TracesPage`

### Legacy compatibility bridge

`filterStore.ts` exports a `getFilterValues()` function that maps legacy field names to new ones:

```typescript
const fieldMap = {
  "traces.status": "status",
  "traces.origin": "origin",
  "spans.service": "service",
  "spans.model": "model",
};
```

This is exported but **not actively imported** anywhere in the codebase. It exists as a bridge for potential future migration of analytics pages.

### Legacy filter fields not yet in new system

The legacy system supports fields the new system doesn't:

| Legacy field | New system equivalent | Status |
|---|---|---|
| `topics.topics` / `topics.subtopics` | `topic` / `subtopic` facets exist but no filter handler | Discoverable, not filterable via query |
| `metadata.user_id` | `user` field | Covered |
| `metadata.thread_id` | `conversation` field | Covered |
| `metadata.labels` | `label` facet exists but no filter handler | Discoverable, not filterable via query |
| `metadata.key` / `metadata.value` | `metadataKeys` dynamic facet exists but no filter handler | Discoverable, not filterable via query |
| `metadata.customer_id` | No equivalent | Not covered |
| `metadata.prompt_ids` | No equivalent | Not covered |
| `evaluations.evaluator_id` | `eval` field | Covered |
| `evaluations.passed` / `evaluations.score` / `evaluations.state` / `evaluations.label` | No equivalent | Not covered |
| `events.event_type` | `event` field | Covered |
| `events.metrics.key` / `events.metrics.value` | No equivalent | Not covered |
| `events.event_details.key` | No equivalent | Not covered |
| `annotations.hasAnnotation` | `has:annotation` | Covered |

Key gap: **evaluation result filtering** (passed/failed, score ranges, labels) is available in the legacy system but not in the new one.

---

## Test & Spec Coverage

### Feature specifications

**`specs/traces-v2/search.feature`** (1,066 lines, 141+ scenarios) -- comprehensive BDD spec covering:
- Time range selector (9 scenarios)
- Search bar layout and keyboard shortcuts (7 scenarios)
- Query syntax and supported fields (22 scenarios)
- Autocomplete (5 scenarios)
- Filter column layout and collapse/expand (13 scenarios)
- Filter chip bar (7 scenarios)
- Three-stage checkboxes (9 scenarios)
- Range facets (9 scenarios)
- Origin-specific facets (5 scenarios)
- Lens-locked filters (3 scenarios)
- Two-way sync (18 scenarios)
- Round-trip fidelity (4 scenarios)
- Edge cases (5 scenarios)
- Facet count updates and display (9 scenarios)
- Zero-count values (3 scenarios)
- High-cardinality facets (9 scenarios)
- Data gating (3 scenarios)
- Error states (4 scenarios)
- Performance (4 scenarios)

**`specs/traces-v2/data-layer.feature`** (630 lines) -- covers data layer integration including filter context in trace list fetching, facet counts, and autocomplete.

### Unit tests

**`server/analytics/clickhouse/__tests__/filter-translator.test.ts`** (529 lines, 65+ test cases) -- covers the **legacy** ClickHouse filter translation (topics, metadata, traces, spans, evaluations, events, annotations, SQL injection prevention). This tests the legacy filter path, not the new `filter-to-clickhouse.ts`.

### Missing test coverage

The following core files in the new system have **no dedicated unit tests**:

| File | Lines | Risk |
|------|-------|------|
| `features/traces-v2/utils/queryParser.ts` | 435 | High -- parser edge cases, AST surgery |
| `server/app-layer/traces/filter-to-clickhouse.ts` | 424 | High -- SQL generation, all field handlers |
| `features/traces-v2/stores/filterStore.ts` | 223 | Medium -- state mutations, debounce logic |
| `features/traces-v2/components/SearchBar/filterHighlight.ts` | 47 | Low -- cosmetic |

The feature specs in `search.feature` describe the expected behavior extensively, but no automated tests exercise the implementation yet. The `filter-to-clickhouse.ts` backend translator is the highest-risk untested code -- it generates SQL for all 13 fields with multiple operator variants.
