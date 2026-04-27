# PRD-022: Data Layer

Parent: [Design: Trace v2](../trace-v2.md)
Status: DRAFT
Date: 2026-04-23

## What This Is

The data fetching, state management, caching, and error handling layer for the traces-v2 frontend. This is not UI — it's the plumbing between React components and ClickHouse. Components call hooks; hooks return data. Everything in between is this PRD's scope.

The existing `tracesRouter` and `TraceService` are NOT reused. This is a clean-sheet data layer with a new tRPC router, new app-layer services, and new repositories. The tRPC router calls services; services call repositories; repositories query ClickHouse. No direct DB access from routers.

## Why It Matters

React state management in the current product is a mess. State is scattered across useState hooks, there are race conditions between filter changes and data fetches, loading states flash when they shouldn't, and there's no caching. This PRD designs a system where:

- There is exactly one source of truth for each piece of state
- Data fetches are automatic, cached, deduplicated, and retried
- Errors are typed and render specific, actionable messages
- Users never see a loading spinner when there's data to show

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  COMPONENTS (zero data logic, read from hooks only)      │
├──────────────────────────────────────────────────────────┤
│  DATA HOOKS (useTraceList, useTraceHeader, etc.)         │
│  Each hook: reads Zustand (intent) → calls TQ (data)    │
├────────────┬─────────────────────────────────────────────┤
│  ZUSTAND   │  TANSTACK QUERY                             │
│  (intent)  │  (server state + cache)                     │
│            │                                             │
│  filter    │  queryClient (httpBatchStreamLink)           │
│  view      │  ├─ trace.list       (stale: 30s)           │
│  ui        │  ├─ trace.header     (stale: 5min)          │
│ +URL       │  ├─ span.summary     (stale: 5min)          │
│            │  ├─ span.detail      (stale: 5min)          │
│            │  ├─ trace.evals      (stale: 60s)           │
│            │  └─ trace.facets     (stale: 30s)           │
├────────────┴──────────┬──────────────────────────────────┤
│  tRPC CLIENT          │  SSE (existing sseLink)          │
│  (typed, streamed)    │  Live tail → pushes into cache   │
├───────────────────────┴──────────────────────────────────┤
│  NEW tRPC ROUTER: tracesV2                               │
│  Thin: validates input, calls services                   │
├──────────────────────────────────────────────────────────┤
│  EXISTING APP-LAYER SERVICES (extended)                  │
│  TraceSummaryService + SpanStorageService +               │
│  EvaluationRunService — add new query methods            │
├──────────────────────────────────────────────────────────┤
│  EXISTING REPOSITORIES (extended)                        │
│  TraceSummaryRepository, SpanStorageRepository, etc.     │
│  Add: list, facets, grouped, newCount query methods      │
├──────────────────────────────────────────────────────────┤
│  CLICKHOUSE                                              │
│  trace_summaries │ stored_spans │ evaluation_runs        │
└──────────────────────────────────────────────────────────┘
```

### Separation of concerns

| Layer | Owns | Does NOT own |
|-------|------|-------------|
| Zustand | User intent: what filters, which lens, which drawer, UI prefs | Server data, cache, fetch timing |
| TanStack Query | Server data, cache lifecycle, dedup, retry, GC | User intent, UI state |
| Hooks | Bridging: read Zustand intent → derive TQ query keys → return data | Business logic, rendering |
| Components | Rendering, user interaction | Data fetching, state shape |

## Data Sources

All queries go to ClickHouse. No Postgres, no analytics tables.

| Table | Purpose | Key fields |
|-------|---------|-----------|
| `trace_summaries` | Trace list, header, I/O preview, filters | `ComputedInput`, `ComputedOutput`, `Models`, `TotalCost`, `TotalDurationMs`, `Attributes` map |
| `stored_spans` | Span tree, span detail, events | `SpanAttributes` map (type, model, I/O), `Events.*` nested arrays |
| `evaluation_runs` | Eval results per trace | `TraceId`, `Score`, `Passed`, `Status` |

**The trace list is a single-table query on `trace_summaries`.** No span joins. `ComputedInput`/`ComputedOutput` provides I/O preview. `Models` array provides model names. `Attributes` map provides user ID, conversation ID, origin, service, labels.

Spans are only queried at Level 1+ (drawer open and deeper).

## Zustand Stores (3 slices) + URL-driven Drawer State

### Filter Store

Source of truth for all filtering and pagination state.

| Field | Type | Purpose |
|-------|------|---------|
| `ast` | `FilterAST` | Parsed query tree from PRD-003 grammar |
| `timeRange` | `{ from: string; to: string }` | Relative (`now-24h`) or absolute ISO |
| `page` | `number` | Current page (1-indexed) |
| `pageSize` | `number` | Default 50 |

**Actions:** `setAST`, `toggleFacet`, `setRange`, `setTimeRange`, `setPage`, `clearAll`

The AST is the single source. `toggleFacet` mutates the AST. The search bar reads the AST and serializes to text. The sidebar reads the AST and projects to checkbox/slider state. One direction only. No two-way sync bugs.

### View Store

Active lens configuration and draft state.

| Field | Type | Purpose |
|-------|------|---------|
| `activeLensId` | `string` | Currently selected view tab |
| `allLenses` | `LensConfig[]` | Built-in + custom lenses |
| `draftGrouping` | `GroupingMode \| null` | Unsaved grouping change |
| `draftConditionalFormatting` | `ConditionalFormatRule[] \| null` | Unsaved formatting change |
| `visibleColumns` | `string[]` | Derived from active lens columns |

**Actions:** `selectLens`, `saveLens`, `saveAsNew`, `revertLens`, `deleteLens`, `setDraftGrouping`, `setDraftConditionalFormatting`, `reorderColumns`, `resizeColumn`, `toggleColumn`

Phase 3A: lenses persist in localStorage (same as mock). Phase 3B moves to server-side via Postgres.

### Drawer State (URL-driven, no Zustand store)

Drawer state lives entirely in URL params. No Zustand drawer store. The URL is the source of truth. Hooks read from URL params via the router.

| URL param | Type | Purpose |
|-----------|------|---------|
| `trace` | `string` | Active trace. Present = drawer open. Absent = drawer closed. |
| `span` | `string` | Selected span (enables Level 2 fetch) |
| `mode` | `'trace' \| 'conversation'` | Display mode |
| `viz` | `'waterfall' \| 'flame' \| 'spanlist'` | Visualization tab |

Accordion expanded/collapsed state is component-local (useState). It controls Level 3 query `enabled` flags but doesn't need to survive URL sharing or refresh.

Hooks read these params directly:
```typescript
function useTraceHeader() {
  const traceId = useSearchParam('trace');  // from URL
  return api.tracesV2.header.useQuery(
    { traceId: traceId! },
    { staleTime: 300_000, enabled: !!traceId }
  );
}
```

### UI Store

Persisted to localStorage via Zustand persist middleware.

| Field | Type | Purpose |
|-------|------|---------|
| `density` | `'compact' \| 'comfortable'` | Row height |
| `sidebarCollapsed` | `boolean` | Filter sidebar state |
| `vizHeight` | `number` | Resizable viz area height |

## Progressive Loading (5 levels)

Data is fetched in thin, targeted slices. Each level fires only when the user's action requires it.

### Level 0: Table (always active)

| Hook | Fires when | ClickHouse table | Stale time |
|------|-----------|-----------------|-----------|
| `useTraceList` | Always (page load) | `trace_summaries` | 30s |
| `useTraceFacets` | Always | `trace_summaries` | 30s |
| `useSearchAutocomplete` | User types `@field:` | `trace_summaries` | 5min |
| `useTraceListGrouped` | Grouping != flat | `trace_summaries` | 30s |
| `useTraceNewCount` | Always (polls every 30s) | `trace_summaries` | 0 |

### Level 1: Drawer opens (row click)

| Hook | Fires when | ClickHouse table | Stale time |
|------|-----------|-----------------|-----------|
| `useTraceHeader` | `drawerStore.traceId` is set | `trace_summaries` | 5min |
| `useSpanSummary` | `drawerStore.traceId` is set | `stored_spans` (projected, no I/O) | 5min |

### Level 2: Span clicked

| Hook | Fires when | ClickHouse table | Stale time |
|------|-----------|-----------------|-----------|
| `useSpanDetail` | `drawerStore.selectedSpanId` is set | `stored_spans` (full row) | 5min |

### Level 3: Accordion expanded

| Hook | Fires when | ClickHouse table | Stale time |
|------|-----------|-----------------|-----------|
| `useTraceEvents` | Events accordion opened | `stored_spans` (Events arrays) | 5min |
| `useTraceEvals` | Evals accordion opened | `evaluation_runs` | 60s |
| `useTraceConversation` | Conversation accordion opened | `trace_summaries` (by thread) | 60s |

### SSE: Live Tail

| Hook | Fires when | Transport | Cache behavior |
|------|-----------|----------|---------------|
| `useLiveTail` | Live Tail page open | SSE via existing `sseLink` | Pushes into `trace.list` cache |

### Prefetch

| Hook | Fires when | What it prefetches |
|------|-----------|-------------------|
| `usePrefetchTrace` | Hover on trace row (150ms delay) | `trace.header` + `span.summary` |

## Filter State Machine

```
User action (sidebar click, search bar edit, slider drag)
    │
    v
Mutate AST (Zustand filterStore)
    │
    ├──▸ Serialize AST → update search bar text     (SYNC, instant)
    ├──▸ Project AST → update sidebar checkboxes    (SYNC, instant)
    ├──▸ Serialize AST → update URL params          (SYNC, instant)
    │
    v
Debounce 300ms (TQ key derivation ONLY, not store mutations)
    │
    v
TanStack Query key changes → automatic refetch
    │
    ├──▸ trace.list refetches (shows previous data while loading)
    ├──▸ trace.facets refetches
    │
    v
New data arrives → components re-render
```

The 300ms debounce applies ONLY to TanStack Query key derivation, NOT to Zustand store mutations. AST updates and their UI projections (search bar text, sidebar checkboxes, URL) are synchronous and immediate.

### Strongly typed filter field registry

Every filterable field is defined once in a typed registry. The registry drives:
- The search bar's `@field:` autocomplete (which fields exist, what values they accept)
- The sidebar's facet rendering (which facet type: checkbox, range slider, etc.)
- The AST parser's validation (reject unknown fields, validate value types)
- The ClickHouse query builder (how each field maps to a WHERE clause)

One source of truth. Add a new filterable field in one place, it appears everywhere.

```typescript
// Shared between client and server

type FilterFieldType = 'enum' | 'range' | 'boolean' | 'text' | 'existence' | 'array';

interface FilterFieldDef {
  /** The @field name used in the search syntax */
  field: string;
  /** Human label for the sidebar */
  label: string;
  /** What kind of values this field accepts */
  type: FilterFieldType;
  /** Sidebar facet rendering: checkbox list, range slider, or hidden (search-only) */
  facet: 'checkbox' | 'range' | 'hidden';
  /** Known enum values (for checkbox facets). Null = dynamic from data. */
  values?: readonly string[];
  /** Range config (for range facets) */
  range?: { unit: string; min?: number; max?: number };
}

const FILTER_FIELDS = {
  status:       { field: 'status',       label: 'Status',       type: 'enum',      facet: 'checkbox', values: ['error', 'warning', 'ok'] },
  origin:       { field: 'origin',       label: 'Origin',       type: 'enum',      facet: 'checkbox', values: ['application', 'simulation', 'evaluation'] },
  model:        { field: 'model',        label: 'Model',        type: 'enum',      facet: 'checkbox' },  // dynamic values
  service:      { field: 'service',      label: 'Service',      type: 'enum',      facet: 'checkbox' },  // dynamic values
  type:         { field: 'type',         label: 'Span Type',    type: 'enum',      facet: 'checkbox', values: ['llm', 'tool', 'agent', 'rag', 'chain', 'module', 'evaluation', 'guardrail'] },
  user:         { field: 'user',         label: 'User',         type: 'enum',      facet: 'hidden' },    // search-only, high cardinality
  conversation: { field: 'conversation', label: 'Conversation', type: 'text',      facet: 'hidden' },    // search-only
  cost:         { field: 'cost',         label: 'Cost',         type: 'range',     facet: 'range', range: { unit: '$' } },
  duration:     { field: 'duration',     label: 'Latency',      type: 'range',     facet: 'range', range: { unit: 'ms' } },
  tokens:       { field: 'tokens',       label: 'Tokens',       type: 'range',     facet: 'range', range: { unit: '' } },
  has:          { field: 'has',          label: 'Has',          type: 'existence', facet: 'hidden', values: ['error', 'eval', 'feedback', 'annotation', 'conversation'] },
  eval:         { field: 'eval',         label: 'Eval',         type: 'enum',      facet: 'hidden' },    // search-only
  event:        { field: 'event',        label: 'Event',        type: 'enum',      facet: 'hidden' },    // search-only
  trace:        { field: 'trace',        label: 'Trace ID',     type: 'text',      facet: 'hidden' },    // search-only
} as const satisfies Record<string, FilterFieldDef>;

type FilterFieldName = keyof typeof FILTER_FIELDS;
```

### Filter → ClickHouse mapping

Each registry entry maps to a ClickHouse expression. This mapping lives in the repository layer (`filter-to-clickhouse.ts`). The service layer passes the typed AST; the repository translates.

```typescript
// Repository layer — one function per field type

const FIELD_TO_CH: Record<FilterFieldName, (value: string) => string> = {
  status:       (v) => v === 'error' ? 'ContainsErrorStatus = 1' : `ContainsOKStatus = ${v === 'ok' ? 1 : 0}`,
  origin:       (v) => `Attributes['langwatch.origin'] = '${v}'`,
  model:        (v) => v.endsWith('*') ? `arrayExists(m -> m LIKE '${v}', Models)` : `has(Models, '${v}')`,
  service:      (v) => `Attributes['service.name'] = '${v}'`,
  type:         (v) => `TraceId IN (SELECT DISTINCT TraceId FROM stored_spans WHERE SpanAttributes['langwatch.span.type'] = '${v}')`,
  user:         (v) => `Attributes['langwatch.user_id'] = '${v}'`,
  conversation: (v) => `Attributes['gen_ai.conversation.id'] = '${v}'`,
  cost:         (v) => rangeToSql('TotalCost', v),
  duration:     (v) => rangeToSql('TotalDurationMs', v, { unit: 'ms' }),
  tokens:       (v) => rangeToSql('TotalPromptTokenCount + TotalCompletionTokenCount', v),
  has:          (v) => hasToSql(v),
  eval:         (v) => `TraceId IN (SELECT TraceId FROM evaluation_runs WHERE EvaluatorName = '${v}')`,
  event:        (v) => `TraceId IN (SELECT TraceId FROM evaluation_runs WHERE EvaluatorType = '${v}')`,
  trace:        (v) => `TraceId = '${v}'`,
};
// Note: all values are parameterized in real implementation, not string-interpolated.
// String interpolation shown here for clarity only.
```

### AST type safety

The filter AST is typed against the registry:

```typescript
type FilterClause =
  | { type: 'field'; field: FilterFieldName; operator: '=' | '!=' | '>' | '<' | 'between' | 'like'; value: string; valueTo?: string }
  | { type: 'text'; query: string }
  | { type: 'group'; operator: 'AND' | 'OR'; clauses: FilterClause[] };

type FilterAST = {
  root: FilterClause | null;
};
```

The parser rejects unknown fields at parse time (throws `FilterFieldUnknownError`). The ClickHouse translator only accepts `FilterFieldName` keys. Type errors at compile time, not runtime.

### Facet cross-filtering

Each facet section's counts exclude its own filter. When "error" is checked in Status, the Status facet still shows counts for "warning" and "ok" as if Status weren't filtered. Backend runs one COUNT query per facet section, each with the full WHERE minus that section's filter. 7-8 parallel queries.

**Degradation:** If a facet query exceeds 500ms, show stale counts from the previous result while refreshing in background.

## Loading States

### Rule: Never show loading when data exists

| State | Behavior |
|-------|----------|
| No data + fetching | Skeleton / spinner |
| No data + error | Error boundary with retry |
| Has data + fetching | Show existing data + subtle refetch indicator |
| Has data + error | Show existing data + subtle error indicator |

TanStack Query's `isLoading` (first load only) vs `isFetching` (any fetch) provides this distinction. Components show skeletons only on `isLoading`.

On page change or lens switch: show previous data until new data arrives (`placeholderData: (prev) => prev`). No loading flash.

### Error boundaries per loading level

```
┌─ TABLE ERROR BOUNDARY ─────────────────────────────────┐
│  ┌─ DRAWER ERROR BOUNDARY ──────────────────────────┐  │
│  │  ┌─ SPAN DETAIL ERROR BOUNDARY ───────────────┐  │  │
│  │  │  Drawer + waterfall stay visible.           │  │  │
│  │  │  Only this panel shows error.               │  │  │
│  │  └────────────────────────────────────────────┘  │  │
│  │  ┌─ ACCORDION ERROR BOUNDARY ─────────────────┐  │  │
│  │  │  Other accordions unaffected.               │  │  │
│  │  └────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────┘
```

A span detail error does NOT crash the drawer. An accordion error does NOT affect other accordions. Each level recovers independently.

## Domain Errors

Uses the existing `DomainError` infrastructure (`src/server/app-layer/domain-error.ts`). The tRPC `domainErrorMiddleware` auto-converts to TRPCErrors. The `errorFormatter` serializes to `error.data.domainError` on the wire. The frontend pattern-matches on `kind`.

### Error types

| Kind | HTTP | Retryable | User sees |
|------|------|-----------|-----------|
| `trace_not_found` | 404 | No | "Trace no longer exists." [Close drawer] |
| `span_not_found` | 404 | No | "Span data unavailable." [Select different span] |
| `thread_not_found` | 404 | No | "No traces for this conversation." |
| `query_timeout` | 504 | 1 retry | "Query timed out (Xs). Try narrowing filters." |
| `clickhouse_unavailable` | 503 | 6 retries | "Database temporarily unavailable. Retrying..." |
| `filter_parse_error` | 422 | No | Inline red underline in search bar at error position |
| `filter_field_unknown` | 422 | No | "Unknown field @X. Try: @status, @model, ..." |
| `time_range_too_wide` | 422 | No | "Maximum N days. Narrow time range." |
| `too_many_results` | 422 | No | "Too many results. Add filters." |

### Special: filter_parse_error

Not handled by error boundaries. The search bar catches it inline:
- Red underline at the character position
- Tooltip with the expected syntax
- Previous valid results stay visible (table doesn't clear)

### Retry behavior by error kind

- `clickhouse_unavailable`: up to 6 retries with backoff
- `query_timeout`: 1 retry
- All 404s and 422s: never retry (user needs to fix something)
- Unknown errors: up to 4 retries (existing default)

## URL State Sync

Full app state serialized to URL parameters. Users can share links. Browser back/forward works.

```
/traces?lens=all-traces&q=@status:error&from=now-24h&to=now&page=1&trace=abc123&span=def456&viz=waterfall&mode=trace
```

| Param | Store | Description |
|-------|-------|-------------|
| `lens` | viewStore | Active lens ID |
| `q` | filterStore | Serialized filter AST |
| `from`, `to` | filterStore | Time range |
| `page` | filterStore | Page number |
| `trace` | drawerStore | Open drawer with this traceId |
| `span` | drawerStore | Selected span |
| `viz` | drawerStore | Visualization tab |
| `mode` | drawerStore | View mode (trace/conversation) |

**Sync behavior:**
- On mount: parse URL → hydrate all stores
- On store change: serialize → `replaceState` (no history entry per keystroke)
- On popstate (back/forward): parse URL → update stores
- Drawer open/close: `pushState` (creates history entry)

## Streaming (httpBatchStreamLink)

Upgrade `httpBatchLink` to `httpBatchStreamLink` in `utils/api.tsx`. When multiple queries fire together (e.g., drawer open triggers `trace.header` + `span.summary`):

1. Single HTTP request
2. Server returns JSON-L: each response streams as it's ready
3. `trace.header` (fast, single row) arrives first → drawer header renders
4. `span.summary` (multiple rows) arrives next → waterfall appears

**Prerequisite:** Verify deployment infrastructure supports unbuffered streaming responses on `/api/trpc`.

## Cache Strategy

| Query | Stale | GC | placeholderData |
|-------|-------|-----|----------------|
| trace.list | 30s | 5min | Previous data |
| trace.facets | 30s | 5min | No |
| trace.header | 5min | 30min | No |
| span.summary | 5min | 30min | No |
| span.detail | 5min | 30min | No |
| trace.events | 5min | 30min | No |
| trace.evals | 60s | 10min | No |
| trace.conversation | 60s | 10min | No |
| search.suggest | 5min | 30min | No |
| trace.newCount | 0 | 0 | No |

- Drawer-level data has long stale times because traces are immutable once written
- Evals are shorter (60s) because evaluations may still be running
- GC time = how long after last subscriber unmounts before TQ drops the cache

## Security

- All endpoints: `protectedProcedure` + `checkProjectPermission("traces:view")`
- Every ClickHouse query includes `WHERE TenantId = ?` (injected server-side from session, never from client)
- Filter AST values escaped/validated before ClickHouse query construction
- No raw user input in SQL
- Rate limiting on `search.suggest` (high-cardinality fields)

## Phase

Phase 3A. This is the bridge between mock UI (Phase 1-2) and production data.

## Implementation Notes

- Feature lives at `src/features/traces-v2/`
- tRPC router at `src/server/api/routers/traces-v2/` (thin: validates input, calls services)
- Uses existing app-layer services + one new service:
  - **NEW** `TraceListService` — `list`, `facets`, `grouped`, `newCount`, `suggest` (the list/filter/facet logic is substantial enough to warrant its own service, not bolted onto `TraceSummaryService` which is focused on ingestion)
  - `TraceSummaryService` — already has `getByTraceId` (used for drawer header)
  - `SpanStorageService` — already has `getSpansByTraceId`, `getEventsByTraceId`. Add: `getSummaryByTraceId` (projected, no I/O)
  - `EvaluationRunService` — already has `getByEvaluationId`. Add: `getByTraceId`
- Services call existing repositories, extended with new query methods where needed
- Filter AST → ClickHouse WHERE translation lives in the repository layer
- Reuses existing tRPC infra: `api` client, `sseLink`, `splitLink`, `TRPCProvider`, auth/RBAC
- Does NOT reuse existing `tracesRouter` (old tRPC router) — new router, same services
- Does NOT query `analytics_trace_facts` or `analytics_evaluation_facts` (deprecated)
