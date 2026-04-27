# Phase 3A: App Networking Layer — CEO Plan & Spec

## Status
SELECTIVE EXPANSION mode. 4 cherry-picks accepted (prefetch on hover, URL deep linking, error boundaries per level, httpBatchStreamLink).

## Context
Phase 1 (16 PRDs) and Phase 2 (5 PRDs, lens engine) are spec'd and mocked in observe-exp. Phase 3A turns the mock into a production frontend. The feature lives at:

```
/Users/afr/Source/github.com/langwatch/langwatch-saas/langwatch/langwatch/src/features/traces-v2/
```

**Critical constraint:** This is a clean-sheet data layer. The existing `tracesRouter` and `TraceService` are NOT reused. New tRPC router, new ClickHouse queries. The existing tRPC infrastructure (api client, SSE link, auth, RBAC) IS reused.

**ClickHouse tables (the only data sources):**
- `trace_summaries` — 70K rows, 37 cols. Primary trace table with Attributes map.
- `stored_spans` — 175K rows, 31 cols. Full span data with SpanAttributes map.
- `evaluation_runs` — 18K rows. Eval results by trace.
- `simulation_runs` — simulation data with Messages/Verdict.
- NOT `analytics_trace_facts` or `analytics_evaluation_facts` (old, deprecated).

**Key attribute locations (all in Map fields):**
- User ID: `trace_summaries.Attributes['langwatch.user_id']` or `['user.id']`
- Conversation: `trace_summaries.Attributes['gen_ai.conversation.id']` or `['thread.id']`
- Origin: `trace_summaries.Attributes['langwatch.origin']`
- Service: `trace_summaries.Attributes['service.name']`
- Span type: `stored_spans.SpanAttributes['langwatch.span.type']`
- Model: `stored_spans.SpanAttributes['gen_ai.request.model']`
- I/O: `stored_spans.SpanAttributes['langwatch.input']` / `['langwatch.output']`

## Architecture Overview

```
┌───────────────────────────────────────────────────────┐
│                    COMPONENTS                         │
│  (TraceTable, Drawer, FilterSidebar, SearchBar, etc.) │
│  Zero data logic. Read from hooks only.               │
├───────────────────────────────────────────────────────┤
│                   DATA HOOKS LAYER                    │
│  useTraceList, useTraceHeader, useSpanDetail, etc.    │
│  Each hook: reads Zustand (intent) + calls TQ (data)  │
├───────────┬───────────────────────────────────────────┤
│  ZUSTAND  │         TANSTACK QUERY                    │
│  (intent) │         (server state + cache)             │
│           │                                           │
│  filter   │  queryClient (httpBatchStreamLink)         │
│  view     │  ├─ trace.list (stale: 30s)               │
│  drawer   │  ├─ trace.header (stale: 5min)            │
│  ui       │  ├─ span.summary (stale: 5min)            │
│           │  ├─ span.detail (stale: 5min)             │
│           │  ├─ trace.evals (stale: 60s)              │
│           │  └─ trace.facets (stale: 30s)             │
├───────────┴─────────┬─────────────────────────────────┤
│  tRPC CLIENT        │  SSE (sseLink, existing)        │
│  (typed, batched,   │  Live tail subscription         │
│   streamed JSON-L)  │  Pushes into TQ cache           │
├─────────────────────┴─────────────────────────────────┤
│         NEW tRPC ROUTER (traces-v2)                   │
│         ClickHouse direct queries                     │
│         src/server/api/routers/traces-v2/             │
├───────────────────────────────────────────────────────┤
│                   CLICKHOUSE                          │
│  trace_summaries | stored_spans | evaluation_runs     │
└───────────────────────────────────────────────────────┘
```

## Naming Convention
Directory is `traces-v2/` (kebab-case). The tRPC router key in `appRouter` is `tracesV2` (camelCase). All client code uses `api.tracesV2.*`.

## Hook Migration Path

| Hook | Exists in mock? | Phase 3A action |
|------|----------------|-----------------|
| useTraceList | Yes | Swap internals for tRPC |
| useTraceHeader | Yes | Swap internals for tRPC |
| useSpanSummary | Yes | Swap internals for tRPC |
| useSpanDetail | Yes | Swap internals for tRPC |
| useTraceEvents | Yes | Swap internals for tRPC |
| useTraceFacets | No | Create new |
| useSearchAutocomplete | No | Create new |
| useTraceListGrouped | No | Create new |
| useTraceNewCount | No | Create new |
| useTraceEvals | No | Create new |
| useTraceConversation | No | Create new |
| useLiveTail | No | Create new |
| usePrefetch | No | Create new |

## Lens Persistence
Phase 3A: lenses stay in localStorage (same as Phase 2 mock). The `useLensSystem` hook works unchanged. Phase 3B introduces a tRPC endpoint backed by Postgres for server-side lens CRUD, enabling team-shared views.

## Simulation Data
`simulation_runs` is listed as a data source but NOT in Phase 3A scope. No hooks, queries, or endpoints for it. Simulation diff is Phase 4+. The table is referenced here only so the schema is documented alongside the other tables.

## File Structure

### Frontend (`src/features/traces-v2/`)
```
hooks/
  useTraceList.ts          # Level 0: paginated trace table
  useTraceFacets.ts        # Level 0: sidebar facet counts
  useSearchAutocomplete.ts # Level 0: @field: suggestions
  useTraceListGrouped.ts   # Level 0: grouped accordion view
  useTraceNewCount.ts      # Level 0: "N new traces" poll
  useTraceHeader.ts        # Level 1: drawer header metadata
  useSpanSummary.ts        # Level 1: span tree skeleton
  useSpanDetail.ts         # Level 2: full span I/O + attributes
  useTraceEvents.ts        # Level 3: events accordion
  useTraceEvals.ts         # Level 3: evals accordion
  useTraceConversation.ts  # Level 3: thread traces
  useLiveTail.ts           # SSE: real-time trace stream
  usePrefetch.ts           # Hover prefetch for drawer data

stores/
  filterStore.ts           # AST source of truth, two-way sync
  viewStore.ts             # Active lens, draft state, columns
  drawerStore.ts           # Open/closed, traceId, spanId, viz mode
  uiStore.ts               # Density, sidebar collapsed, persisted prefs

lib/
  filterAST.ts             # Parse/serialize PRD-003 query grammar
  urlState.ts              # URL <-> Zustand sync middleware
  queryKeys.ts             # Centralized TQ key factory
  errorBoundaries.tsx      # Per-level error boundary components

types/
  index.ts                 # Shared types (from mock types, adapted)
```

### Backend (`src/server/api/routers/traces-v2/`)
```
router.ts                  # New tRPC router (protectedProcedure + RBAC)
schemas.ts                 # Zod input/output schemas
queries/
  traceList.ts             # CH query: paginated, filtered, sorted
  traceHeader.ts           # CH query: single trace summary
  spanSummary.ts           # CH query: spans for trace (projected)
  spanDetail.ts            # CH query: single span full detail
  traceEvents.ts           # CH query: events from span arrays
  traceEvals.ts            # CH query: evaluation_runs by traceId
  traceFacets.ts           # CH query: facet counts per section
  searchSuggest.ts         # CH query: field value suggestions
  traceGrouped.ts          # CH query: grouped with aggregates
  liveTail.ts              # SSE subscription: new traces stream
utils/
  filterToClickHouse.ts    # AST -> ClickHouse WHERE clause translator
```

## Zustand Store Architecture

### Filter Store (`filterStore.ts`)

```typescript
interface FilterStore {
  // Source of truth
  ast: FilterAST;              // Parsed query tree
  timeRange: TimeRange;        // { from: string; to: string }
  page: number;
  pageSize: number;            // default 50
  
  // Derived (computed from AST for sidebar sync)
  // Components read these; mutations go through AST
  
  // Actions
  setAST: (ast: FilterAST) => void;           // From search bar parse
  toggleFacet: (field: string, value: string) => void;  // From sidebar click
  setRange: (field: string, min: number, max: number) => void;  // Slider
  setTimeRange: (range: TimeRange) => void;
  setPage: (page: number) => void;
  clearAll: () => void;
  
  // AST is the single source. toggleFacet mutates the AST.
  // Search bar reads AST and serializes to text.
  // Sidebar reads AST and projects to checkbox/slider state.
  // No two-way sync bugs because there's only one source.
}
```

### View Store (`viewStore.ts`)

```typescript
interface ViewStore {
  activeLensId: string;
  allLenses: LensConfig[];     // Built-in + custom
  draftGrouping: GroupingMode | null;
  draftConditionalFormatting: ConditionalFormatRule[] | null;
  visibleColumns: string[];    // Derived from active lens
  
  // Actions
  selectLens: (id: string) => void;
  saveLens: (id: string) => void;
  saveAsNew: (name: string) => void;
  revertLens: (id: string) => void;
  deleteLens: (id: string) => void;
  setDraftGrouping: (g: GroupingMode) => void;
  setDraftConditionalFormatting: (rules: ConditionalFormatRule[]) => void;
  reorderColumns: (fromIndex: number, toIndex: number) => void;
  resizeColumn: (columnId: string, width: number) => void;
  toggleColumn: (columnId: string) => void;
}
```

### Drawer Store (`drawerStore.ts`)

```typescript
interface DrawerStore {
  isOpen: boolean;
  traceId: string | null;
  selectedSpanId: string | null;
  viewMode: 'trace' | 'conversation';
  vizTab: 'waterfall' | 'flame' | 'spanlist';
  activeTab: 'summary' | 'span';  // Only one span tab open at a time. Selecting a new span replaces the previous.
  
  // Accordion state (controls Level 3 query enablement)
  eventsExpanded: boolean;
  evalsExpanded: boolean;
  conversationExpanded: boolean;
  
  // Actions
  openTrace: (traceId: string) => void;
  closeDrawer: () => void;
  selectSpan: (spanId: string) => void;
  clearSpan: () => void;
  setViewMode: (mode: 'trace' | 'conversation') => void;
  setVizTab: (tab: 'waterfall' | 'flame' | 'spanlist') => void;
  toggleAccordion: (section: 'events' | 'evals' | 'conversation') => void;
}
```

### UI Store (`uiStore.ts`)

```typescript
interface UIStore {
  density: 'compact' | 'comfortable';
  sidebarCollapsed: boolean;
  vizHeight: number;           // Resizable visualization area
  
  // Actions  
  setDensity: (d: 'compact' | 'comfortable') => void;
  toggleSidebar: () => void;
  setVizHeight: (h: number) => void;
}
// Persisted to localStorage via Zustand persist middleware
```

## Query Catalog (15 patterns, 5 levels)

### Level 0: Table (always active)

**1. `useTraceList`**
```typescript
// Hook
function useTraceList() {
  const ast = useFilterStore(s => s.ast);
  const columns = useViewStore(s => s.visibleColumns);
  const sort = useViewStore(s => s.activeLens.sort);
  const { page, pageSize, timeRange } = useFilterStore();
  
  return api.tracesV2.list.useQuery(
    { filters: serializeAST(ast), columns, sort, page, pageSize, timeRange },
    {
      staleTime: 30_000,
      // TQ v5 syntax. In v4 this was keepPreviousData: true
      placeholderData: (previousData) => previousData,
    }
  );
}
// placeholderData with previous = show old page while loading new page
```

**Cache key:** `['tracesV2', 'list', { filters, columns, sort, page, pageSize, timeRange }]`
**CH table:** `trace_summaries` ONLY. No span joins needed. `ComputedInput`/`ComputedOutput` on trace_summaries provides I/O preview. `Models` array, `TotalCost`, `TotalDurationMs`, `ErrorMessage`, `Attributes` map — all on this one table. Single-table query with WHERE from AST, ORDER BY from sort, LIMIT/OFFSET from page.

**2. `useTraceFacets`**
```typescript
function useTraceFacets() {
  const ast = useFilterStore(s => s.ast);
  const timeRange = useFilterStore(s => s.timeRange);
  
  return api.tracesV2.facets.useQuery(
    { filters: serializeAST(ast), timeRange },
    { staleTime: 30_000 }
  );
}
```
Backend runs one COUNT query per facet section. Each facet's counts exclude its own filter (cross-facet interaction).

**3. `useSearchAutocomplete`**
```typescript
function useSearchAutocomplete(field: string, prefix: string) {
  return api.tracesV2.suggest.useQuery(
    { field, prefix },
    { staleTime: 300_000, enabled: prefix.length > 0 }
  );
}
```

**4. `useTraceListGrouped`**
```typescript
function useTraceListGrouped() {
  const ast = useFilterStore(s => s.ast);
  const grouping = useViewStore(s => s.effectiveGrouping);
  const timeRange = useFilterStore(s => s.timeRange);
  
  return api.tracesV2.listGrouped.useQuery(
    { filters: serializeAST(ast), grouping, timeRange },
    { staleTime: 30_000, enabled: grouping !== 'flat' }
  );
}
```
Returns: `{ groups: Array<{ key: string; count: number; avgDuration: number; totalCost: number; traces: TraceSummary[] }> }`

**5. `useTraceNewCount`**
```typescript
function useTraceNewCount() {
  const ast = useFilterStore(s => s.ast);
  const timeRange = useFilterStore(s => s.timeRange);
  const latestTimestamp = useRef<string>();
  
  return api.tracesV2.newCount.useQuery(
    { filters: serializeAST(ast), timeRange, since: latestTimestamp.current },
    { refetchInterval: 30_000 }  // Poll every 30s
  );
}
```

### Level 1: Drawer Opens (on row click)

**6. `useTraceHeader`**
```typescript
function useTraceHeader() {
  const traceId = useDrawerStore(s => s.traceId);
  
  return api.tracesV2.header.useQuery(
    { traceId: traceId! },
    { staleTime: 300_000, enabled: !!traceId }
  );
}
```
**CH query:** `SELECT * FROM trace_summaries WHERE TraceId = ? AND TenantId = ?`

**7. `useSpanSummary`**
```typescript
function useSpanSummary() {
  const traceId = useDrawerStore(s => s.traceId);
  
  return api.tracesV2.spanSummary.useQuery(
    { traceId: traceId! },
    { staleTime: 300_000, enabled: !!traceId }
  );
}
```
**CH query:** `SELECT SpanId, ParentSpanId, SpanName, DurationMs, StatusCode, ServiceName, SpanAttributes['langwatch.span.type'] AS spanType, SpanAttributes['gen_ai.request.model'] AS model, StartTime FROM stored_spans WHERE TraceId = ? AND TenantId = ? ORDER BY StartTime`

Returns lightweight skeleton. No I/O payloads.

### Level 2: Span Clicked

**8. `useSpanDetail`**
```typescript
function useSpanDetail() {
  const spanId = useDrawerStore(s => s.selectedSpanId);
  
  return api.tracesV2.spanDetail.useQuery(
    { spanId: spanId! },
    { staleTime: 300_000, enabled: !!spanId }
  );
}
```
**CH query:** Full `stored_spans` row. SpanAttributes map includes `langwatch.input`, `langwatch.output`, all gen_ai.* fields. Events nested arrays included.

### Level 3: Accordion Expanded

**9. `useTraceEvents`**
```typescript
function useTraceEvents() {
  const traceId = useDrawerStore(s => s.traceId);
  const enabled = useDrawerStore(s => s.eventsExpanded);
  
  return api.tracesV2.events.useQuery(
    { traceId: traceId! },
    { staleTime: 300_000, enabled: !!traceId && enabled }
  );
}
```
**CH query:** `SELECT SpanId, SpanName, Events.Timestamp, Events.Name, Events.Attributes FROM stored_spans WHERE TraceId = ? AND TenantId = ? AND length(Events.Name) > 0`

**10. `useTraceEvals`**
```typescript
function useTraceEvals() {
  const traceId = useDrawerStore(s => s.traceId);
  const enabled = useDrawerStore(s => s.evalsExpanded);
  
  return api.tracesV2.evals.useQuery(
    { traceId: traceId! },
    { staleTime: 60_000, enabled: !!traceId && enabled }
  );
}
```
**CH query:** `SELECT * FROM evaluation_runs WHERE TraceId = ? AND TenantId = ?`
60s stale time because evals may still be running.

**11. `useTraceConversation`**
```typescript
function useTraceConversation() {
  const traceId = useDrawerStore(s => s.traceId);
  const threadId = useTraceHeader()?.data?.threadId;
  const enabled = useDrawerStore(s => s.conversationExpanded);
  
  return api.tracesV2.conversation.useQuery(
    { threadId: threadId! },
    { staleTime: 60_000, enabled: !!threadId && enabled }
  );
}
```
**CH query:** `SELECT * FROM trace_summaries WHERE Attributes['gen_ai.conversation.id'] = ? AND TenantId = ? ORDER BY OccurredAt`

### SSE: Live Tail

**12. `useLiveTail`**
```typescript
function useLiveTail(filters: SerializedAST, enabled: boolean) {
  // Uses existing sseLink via tRPC subscription
  api.tracesV2.liveTail.useSubscription(
    { filters },
    {
      enabled,
      onData: (trace) => {
        // Push into trace.list cache
        queryClient.setQueryData(
          traceListKey(currentFilters),
          (old) => old ? { ...old, items: [trace, ...old.items].slice(0, 500) } : old
        );
      },
    }
  );
}
```
Server-side filtered SSE. Uses existing `sseLink` infrastructure.

### Prefetch (expansion)

**13. `usePrefetch`**
```typescript
function usePrefetchTrace(traceId: string) {
  const queryClient = useQueryClient();
  
  return {
    onMouseEnter: () => {
      // 150ms delay to avoid prefetching on scroll-through
      const timer = setTimeout(() => {
        queryClient.prefetchQuery(api.tracesV2.header.queryOptions({ traceId }));
        queryClient.prefetchQuery(api.tracesV2.spanSummary.queryOptions({ traceId }));
      }, 150);
      return () => clearTimeout(timer);
    }
  };
}
```

## Loading & Error State Rules

### Rule 1: Never show loading when data exists
```
HAS DATA + FETCHING  →  Show existing data + subtle refetch indicator (not skeleton)
HAS DATA + ERROR     →  Show existing data + subtle error indicator
NO DATA + FETCHING   →  Show skeleton/spinner
NO DATA + ERROR      →  Show error boundary with retry
```

TanStack Query gives us this via `keepPreviousData: true` and checking `isFetching` vs `isLoading`:
- `isLoading` = true only on FIRST load (no cached data)
- `isFetching` = true on any fetch (including background refetch)
- Components show skeleton only when `isLoading`, show subtle indicator when `isFetching && !isLoading`

### Rule 2: Error boundaries per loading level
```
┌─ TABLE ERROR BOUNDARY ──────────────────────────────────────┐
│  "Failed to load traces. [Retry]"                           │
│  ┌─ DRAWER ERROR BOUNDARY ────────────────────────────────┐ │
│  │  "Trace unavailable. [Close]"                          │ │
│  │  ┌─ SPAN DETAIL ERROR BOUNDARY ─────────────────────┐  │ │
│  │  │  "Span data failed to load. [Try again]"         │  │ │
│  │  │  Drawer stays open. Waterfall still visible.      │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  │  ┌─ ACCORDION ERROR BOUNDARY ───────────────────────┐  │ │
│  │  │  "Events unavailable. [Retry]"                   │  │ │
│  │  │  Other accordions unaffected.                     │  │ │
│  │  └──────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

### Rule 3: Streaming via httpBatchStreamLink
Upgrade `httpBatchLink` to `httpBatchStreamLink` in `utils/api.tsx`. When drawer opens:
- `trace.header` + `span.summary` batch into one HTTP request
- Server returns JSON-L: header arrives first (renders immediately), spans stream in
- User sees drawer header pop in, then spans incrementally appear in the waterfall

## Filter State Machine

```
User action (sidebar click, search bar edit, slider drag)
    │
    v
Mutate AST (Zustand filterStore)
    │
    ├──► Serialize AST → update search bar text (SYNC, instant)
    ├──► Project AST → update sidebar checkboxes (SYNC, instant)
    ├──► Serialize AST → update URL params (SYNC, instant)
    │
    v
Debounce 300ms (on TQ key derivation ONLY, not on store mutations)
    │
    v
TanStack Query key changes → automatic refetch
    │
    ├──► trace.list refetches (keepPreviousData: true)
    ├──► trace.facets refetches
    │
    v
New data arrives → components re-render with fresh results
```

Key: AST is the ONLY source of truth. No two-way sync bugs because there's only one direction: AST → everything else.

## URL State Sync

```typescript
// URL shape:
// /traces?
//   lens=all-traces&
//   q=@status:error+AND+@model:gpt-4o&
//   from=now-24h&to=now&
//   page=1&
//   trace=abc123&           // drawer open
//   span=def456&            // selected span
//   viz=waterfall&          // viz tab
//   mode=trace              // view mode

// Zustand middleware syncs stores ↔ URL params
// On mount: parse URL → hydrate stores
// On store change: serialize stores → update URL (replaceState)
// On popstate (back/forward): parse URL → update stores
```

## Cache Strategy Summary

| Query | Stale Time | keepPreviousData | GC Time |
|-------|-----------|-----------------|---------|
| trace.list | 30s | yes | 5min |
| trace.facets | 30s | no | 5min |
| trace.header | 5min | no | 30min |
| span.summary | 5min | no | 30min |
| span.detail | 5min | no | 30min |
| trace.events | 5min | no | 30min |
| trace.evals | 60s | no | 10min |
| trace.conversation | 60s | no | 10min |
| search.suggest | 5min | no | 30min |
| trace.newCount | 0 (always refetch) | no | 0 |

- `keepPreviousData: true` ONLY on trace.list (pagination / filter changes should show old data while loading)
- Drawer-level data has long stale times (traces are effectively immutable once written)
- Evals shorter because they may still be processing
- GC time = how long after last subscriber unmounts before TQ drops the cache

## tRPC Link Configuration Update

In `utils/api.tsx`, update the splitLink chain:

```typescript
// Current: httpBatchLink
// New: httpBatchStreamLink (streams JSON-L responses)
import { httpBatchStreamLink } from '@trpc/client';

splitLink({
  condition(op) { return op.type === 'subscription'; },
  true: sseLink({ ... }),  // Keep existing SSE for subscriptions
  false: splitLink({
    condition(op) { return op.context.skipBatch === true; },
    true: httpLink({ ... }),  // Keep for non-batched
    false: httpBatchStreamLink({  // UPGRADE: streaming batch
      url: `${getBaseUrl()}/api/trpc`,
      maxURLLength: 4000,
    }),
    // PREREQUISITE: Verify deployment infra (reverse proxy, CDN, serverless
    // runtime) supports unbuffered streaming responses on /api/trpc.
  }),
})
```

## Domain Error Types

Uses the existing `DomainError` infrastructure at `src/server/app-layer/domain-error.ts`. The tRPC layer already has `domainErrorMiddleware` (auto-converts DomainErrors to TRPCErrors) and `errorFormatter` (serializes to `error.data.domainError` on the wire). `TraceNotFoundError` and `SpanNotFoundError` already exist.

### Existing infrastructure (DO NOT recreate)
- `DomainError` base class with `kind`, `meta`, `httpStatus`, `telemetry`, `serialize()`
- `NotFoundError` (404), `ValidationError` (422) base classes
- `domainErrorMiddleware` in `trpc.ts` — auto-converts to correct tRPC code
- `errorFormatter` in `trpc.ts` — puts serialized domain error in `shape.data.domainError`
- `TraceNotFoundError` (kind: `trace_not_found`) — already exists
- `SpanNotFoundError` (kind: `span_not_found`) — already exists

### New error classes (`src/server/app-layer/traces/errors.ts`)

```typescript
// Add to existing file alongside TraceNotFoundError and SpanNotFoundError

export class ThreadNotFoundError extends NotFoundError {
  declare readonly kind: "thread_not_found";
  constructor(threadId: string) {
    super("thread_not_found", "Thread", threadId, { meta: { threadId } });
  }
}

export class QueryTimeoutError extends DomainError {
  declare readonly kind: "query_timeout";
  constructor(durationMs: number, hint: string) {
    super("query_timeout", `Query timed out after ${durationMs}ms`, {
      meta: { durationMs, hint },
      httpStatus: 504,
    });
  }
}

export class ClickHouseUnavailableError extends DomainError {
  declare readonly kind: "clickhouse_unavailable";
  constructor() {
    super("clickhouse_unavailable", "Database temporarily unavailable", {
      httpStatus: 503,
    });
  }
}

export class FilterParseError extends ValidationError {
  declare readonly kind: "filter_parse_error";
  constructor(input: string, position: number, expected: string) {
    super(`Invalid filter at position ${position}: expected ${expected}`, {
      meta: { input, position, expected },
    });
    Object.defineProperty(this, "kind", { value: "filter_parse_error" });
  }
}

export class FilterFieldUnknownError extends ValidationError {
  declare readonly kind: "filter_field_unknown";
  constructor(field: string, knownFields: string[]) {
    super(`Unknown filter field: @${field}`, {
      meta: { field, knownFields },
    });
    Object.defineProperty(this, "kind", { value: "filter_field_unknown" });
  }
}

export class TimeRangeTooWideError extends ValidationError {
  declare readonly kind: "time_range_too_wide";
  constructor(maxDays: number) {
    super(`Time range exceeds maximum of ${maxDays} days`, {
      meta: { maxDays },
    });
    Object.defineProperty(this, "kind", { value: "time_range_too_wide" });
  }
}

export class TooManyResultsError extends DomainError {
  declare readonly kind: "too_many_results";
  constructor(count: number, limit: number) {
    super("too_many_results", `Query returned ${count} results, limit is ${limit}`, {
      meta: { count, limit, hint: "Add filters to narrow results" },
      httpStatus: 422,
    });
  }
}
```

### Client-side: Extract from TRPCClientError

The existing `errorFormatter` puts the serialized domain error at `error.data.domainError`:

```typescript
// src/features/traces-v2/lib/domainErrors.ts
import type { TRPCClientError } from '@trpc/client';
import type { SerializedDomainError } from '~/server/app-layer/domain-error';

function extractDomainError(error: unknown): SerializedDomainError | null {
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as any).data;
    return data?.domainError ?? null;
  }
  return null;
}
```

### Error Message Rendering (by `kind`)

```typescript
function renderDomainError(err: SerializedDomainError): {
  title: string; description: string; action?: string
} {
  const meta = err.meta;
  switch (err.kind) {
    case 'trace_not_found':
      return {
        title: 'Trace not found',
        description: `Trace ${String(meta.traceId).slice(0, 8)}... no longer exists.`,
        action: 'Close drawer',
      };
    case 'span_not_found':
      return {
        title: 'Span not found',
        description: 'Span data is no longer available.',
        action: 'Select a different span',
      };
    case 'thread_not_found':
      return {
        title: 'Conversation not found',
        description: 'No traces found for this thread.',
      };
    case 'query_timeout':
      return {
        title: `Query timed out (${((meta.durationMs as number) / 1000).toFixed(1)}s)`,
        description: String(meta.hint),
        action: 'Retry with narrower filters',
      };
    case 'clickhouse_unavailable':
      return {
        title: 'Database temporarily unavailable',
        description: 'Retrying automatically...',
      };
    case 'filter_parse_error':
      return {
        title: 'Invalid filter',
        description: `At position ${meta.position}: expected ${meta.expected}`,
        action: 'Fix query',
      };
    case 'filter_field_unknown':
      return {
        title: `Unknown field: @${meta.field}`,
        description: `Try: ${(meta.knownFields as string[]).slice(0, 5).map(f => '@' + f).join(', ')}`,
        action: 'Fix query',
      };
    case 'time_range_too_wide':
      return {
        title: 'Time range too wide',
        description: `Maximum ${meta.maxDays} days.`,
        action: 'Adjust time range',
      };
    case 'too_many_results':
      return {
        title: `Too many results (${(meta.count as number).toLocaleString()})`,
        description: String(meta.hint),
        action: 'Add filters',
      };
    default:
      return {
        title: 'Something went wrong',
        description: err.kind,
        action: 'Retry',
      };
  }
}
```

### TQ Retry integration (by `kind`)

```typescript
retry(failureCount, error) {
  const domainErr = extractDomainError(error);
  if (!domainErr) return failureCount < 4;  // Unknown errors: default retry
  
  switch (domainErr.kind) {
    case 'clickhouse_unavailable': return failureCount < 6;
    case 'query_timeout': return failureCount < 2;
    // User-fixable errors: never retry
    case 'trace_not_found':
    case 'span_not_found':
    case 'filter_parse_error':
    case 'filter_field_unknown':
    case 'time_range_too_wide':
      return false;
    default: return failureCount < 4;
  }
}
```

### Special case: `filter_parse_error`

Caught inline by the search bar, NOT by error boundaries:
- Red underline at `meta.position`
- Tooltip showing `expected: "${meta.expected}"`
- Previous valid results stay visible (table doesn't clear)

## Security & Auth

- All traces-v2 endpoints use `protectedProcedure` + `checkProjectPermission("traces:view")`
- TenantId scoping on every ClickHouse query (mandatory WHERE clause)
- TenantId is injected server-side from the session context, never passed from the client. All hook inputs are user-facing identifiers only (traceId, spanId, etc.)
- No raw user input in ClickHouse SQL — all parameters via parameterized queries
- Filter AST values are escaped/validated before CH query construction
- Rate limiting on suggest/autocomplete endpoints (high-cardinality fields)

## Key Edge Cases & Race Conditions

### Race: Filter change while drawer is open
- Drawer stays open. Drawer data is keyed by traceId (not affected by filter change).
- Table refetches with new filters. If the currently-open trace disappears from results, drawer stays open (data is cached). User can close manually.

### Race: SSE event arrives during filter change
- SSE events are pushed into the trace.list cache. If the debounced filter change then triggers a refetch, TQ replaces the cache with fresh server results. No conflict — TQ's last-write-wins on refetch.

### Race: Rapid filter toggling (click-click-click)
- 300ms debounce on AST → TQ invalidation. Only the final filter state triggers a query.
- `keepPreviousData: true` means old results stay visible through the debounce window.

### Edge: Trace in table but not in ClickHouse yet (eventual consistency)
- User clicks a trace that SSE just pushed. `trace.header` query might return empty if the trace hasn't propagated to `trace_summaries` yet.
- Handle with: domain error `TRACE_NOT_FOUND` + auto-retry (2 attempts, 1s delay). Most eventual consistency gaps are <500ms.

### Edge: Very large traces (300+ spans)
- `span.summary` returns all spans (lightweight: ~100 bytes each, so 300 spans ≈ 30KB).
- `span.detail` is per-span on click. No risk of fetching all 300 span details at once.
- Waterfall rendering virtualized for large span counts (separate component concern, not data layer).

### Edge: Map key lookups for filters
- `trace_summaries.Attributes` is `Map(String, String)`. Filtering by `Attributes['langwatch.user_id']` requires map key access.
- ClickHouse Map access is O(n) per row for non-indexed maps. For high-cardinality filter fields (user ID), this could be slow on large datasets.
- Mitigation: Time range filtering always applied first (narrows scan). Monitor query latency. If slow, consider materialized columns for hot filter fields.

### Edge: Facet cross-filtering
- Each facet section's counts must exclude its own filter. E.g., when "error" is checked in Status, the Status facet still shows counts for "warning" and "ok" as if Status weren't filtered.
- Backend runs N COUNT queries (one per facet section), each with the full WHERE clause minus that section's filter.
- This is O(N) queries per facet refresh. With 7-8 facet sections, that's 7-8 queries. All run in parallel server-side.
- **Degradation threshold:** If any single facet query exceeds 500ms, show stale counts (from previous result) while refreshing in background. If p95 facet latency exceeds 1s at >1M rows, add materialized columns for `user_id`, `origin`, and `service.name`.

## Output Location

The final spec will be written to:
```
/Users/afr/Source/github.com/langwatch/langwatch-saas/langwatch/langwatch/src/features/traces-v2/docs/
```

This keeps the spec co-located with the feature code. The CEO plan at `~/.gstack/projects/observe-exp/ceo-plans/` is a reference copy.

## Success Criteria

1. Components from Phase 2 mock work with real data by swapping hook internals only
2. Drawer open latency < 200ms (header + span skeleton, from TQ cache or server)
3. Trace list pagination: no loading flash when navigating pages (keepPreviousData)
4. Filter change: old results stay visible until new results arrive
5. Live tail: traces appear within 1s of ingestion
6. Zero race conditions between filter changes, drawer open, and SSE updates
7. URL state survives refresh: copy URL, paste in new tab, see same view
8. Error in span detail doesn't crash the drawer — waterfall stays visible
