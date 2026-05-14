# Data Layer — Gherkin Spec
# Covers: state management, data fetching, caching, errors, loading states, URL sync

# ─────────────────────────────────────────────────────────────────────────────
# TRACE LIST (Level 0)
# ─────────────────────────────────────────────────────────────────────────────

Feature: Data layer

Rule: Trace list data fetching
  The trace table fetches paginated, filtered, sorted data from trace_summaries.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces in ClickHouse

  Scenario: Initial page load fetches trace list
    When the Observe page loads
    Then `useTraceListQuery` fires `api.tracesV2.list.useQuery`
    And the query uses the default time range (last 30 days, presetId="30d")
    And the query passes `sort` from `viewStore.sort` (default `{ columnId: "time", direction: "desc" }`)
    And the query passes page=1, pageSize=50 from `filterStore`
    And the query passes the debounced query text (or undefined when empty)
    And `query.live` is true whenever the time range has a label (rolling preset)

  Scenario: Trace list returns I/O preview from trace_summaries
    When the trace list loads
    Then each trace row includes ComputedInput and ComputedOutput
    And these come from trace_summaries, not stored_spans

  Scenario: Page change shows previous data while loading
    Given the trace list is showing page 1 with 50 results
    When the user clicks "next page"
    Then `keepPreviousData: true` keeps page 1 visible
    And when page 2 results arrive, they replace page 1

  Scenario: Trace list respects stale time
    Given the trace list loaded 30 seconds ago
    When a component re-mounts that uses useTraceListQuery with the same params
    Then no new network request fires — staleTime is 60_000 ms

  Scenario: Trace list deduplicates concurrent requests
    Given two components both call useTraceListQuery with the same params
    Then TanStack Query collapses them to a single network request
    And both components receive the same data


# Not yet implemented as of 2026-05-01 — there is no `useTraceListGrouped`
# hook or `tracesV2.listGrouped` endpoint. Lens capabilities define grouping
# modes (`by-service`/`by-user`/`by-model`/`by-conversation`) but the
# server-side grouped query is not wired up.
@planned
Rule: Trace list grouped
  Grouped views show traces organized by a dimension.

  Background:
    Given the user is authenticated
    And the active lens has grouping set to "by-service"

  Scenario: Grouped list fires only when grouping is not flat
    Given the active lens has grouping "flat"
    Then useTraceListGrouped does NOT fire

  Scenario: Grouped list returns groups with aggregates
    When useTraceListGrouped fires
    Then the response contains groups with key, count, avgDuration, totalCost
    And each group contains its trace rows


Rule: New trace count polling
  A poll detects new traces for the "N new traces" banner.

  Scenario: Adaptive polling backs off when no new traces arrive
    Given the Observe page is open and SSE is not connected
    Then useTraceNewCount fires immediately at FAST_MS (5s)
    And after BACKOFF_THRESHOLD (3) consecutive zero-count responses the interval steps up to SLOW_MS (30s)
    And after BACKOFF_THRESHOLD * 2 zero-count responses it steps up to IDLE_MS (120s)
    And every poll includes the current filters, time range, and `since` timestamp

  Scenario: SSE preempts polling when connected
    Given `sseStatusStore.sseConnectionState` is "connected"
    Then useTraceNewCount disables its `refetchInterval` entirely
    And the count refreshes via the SSE-driven invalidation in `useTraceFreshness`

  Scenario: New count reflects current filters
    Given the user has @status:error filter active
    When the poll fires
    Then it counts only new traces matching @status:error


# ─────────────────────────────────────────────────────────────────────────────
# FACETS (Level 0)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Facet counts
  The filter sidebar shows counts for each facet value.

  Scenario: Facets load with the trace list
    When the Observe page loads
    Then `useTraceFacets` calls `api.tracesV2.discover.useQuery` (not `tracesV2.facets`)
    And the discover payload returns categorical facets with `topValues` plus range facets
    And the query opts out of tRPC batching via `trpc.context.skipBatch=true`
    And `staleTime` is 10 minutes (the schema shifts on the order of minutes)

  Scenario: Sidebar keeps previous facets across project switches
    Given useTraceFacets has data for project A
    When the user switches to project B
    Then `keepPreviousData` is project-blind in TanStack Query
    But the hook tracks the most recent successful project id and surfaces an empty array until project B's response lands

  # Not yet implemented — cross-facet exclusion isn't wired through the
  # discover endpoint; counts are computed against the full filter.
  @planned
  Scenario: Cross-facet filtering excludes own filter
    Given the user has checked "error" in the Status facet
    When facets refresh
    Then the Status facet still shows counts for "warning" and "ok"
    And the Status counts are calculated WITHOUT the status filter
    And all other facets include the status:error filter


# ─────────────────────────────────────────────────────────────────────────────
# SEARCH AUTOCOMPLETE (Level 0)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Search autocomplete
  The search bar suggests field names and values from data already in memory.

  Scenario: Field name suggestions come from the static registry
    When the user types "mo" in the search bar
    Then field-mode suggestions are filtered from `FIELD_NAMES` (metadata.ts) plus `DYNAMIC_PREFIXES`
    And no extra network request fires for field names

  Scenario: Categorical value suggestions reuse the discover payload
    When the user types "model:gpt" in the search bar
    Then the SearchBar's `valueResolver` ranks `useTraceFacets` topValues for the matching facetField
    And returns up to MAX_DYNAMIC_ITEMS (10) matches
    And no extra network request fires

  Scenario: Closed-enum values come from FIELD_VALUES
    When the user types "status:" in the search bar
    Then suggestions are pulled from the static `FIELD_VALUES` table (`error`, `warning`, `ok`)

  # `tracesV2.suggest` exists on the router but is not currently called from
  # the SearchBar UI — value suggestions come from the discover payload.
  @planned
  Scenario: tracesV2.suggest is consumed by the SearchBar
    When a user types into the search bar
    Then suggestions stream in from `tracesV2.suggest` for fields with no static enum


# ─────────────────────────────────────────────────────────────────────────────
# FILTER FIELD REGISTRY (strongly typed)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Strongly typed filter field registry
  Every filterable field is defined once in `SEARCH_FIELDS`
  (`server/app-layer/traces/query-language/metadata.ts`). The registry drives
  autocomplete, sidebar facets, AST validation, and ClickHouse query translation.

  Scenario: Unknown field rejected at parse time
    When the user types "modle:gpt-4o" in the search bar
    Then `validateAst` reports an unknown-field error
    And the search bar shows the inline parse error (red outline + message)
    And the trace table does NOT clear (the previous debouncedQueryText keeps driving the list)

  Scenario: New field added in one place appears everywhere
    Given a new entry is added to `SEARCH_FIELDS`
    Then the autocomplete dropdown lists it (FIELD_NAMES is derived from the registry)
    And if `hasSidebar=true` and `facetField` is set the sidebar renders a section
    And the ClickHouse translator picks up the field via `translateFilterToClickHouse`

  Scenario: Sidebar facets driven by registry
    Given a SEARCH_FIELDS entry has `valueType="categorical"` and `hasSidebar=true`
    Then the sidebar renders checkbox rows for that field
    Given a SEARCH_FIELDS entry has `valueType="range"` and `hasSidebar=true`
    Then the sidebar renders a range slider for that field
    Given a SEARCH_FIELDS entry has `hasSidebar=false`
    Then the sidebar does NOT render a section (search-only field, e.g. `traceId`, `spanId`, `event`, `eval`)

  Scenario: Enum field with static values
    Given `FIELD_VALUES.status = ["error", "warning", "ok"]`
    Then the autocomplete for "status:" shows these three values
    And the sidebar uses them as `FACET_DEFAULTS.status`

  Scenario: Enum field with dynamic values
    Given `FIELD_VALUES` does not include `model`
    Then the autocomplete for "model:" pulls top values from the discover payload via `valueResolver`
    And the sidebar checkboxes are populated from `useTraceFacets` counts

  Scenario: Glob/prefix match on supported fields
    When the user types "model:gpt*"
    Then the parser produces a Tag with a wildcard expression
    And the ClickHouse translation uses arrayExists with LIKE


# ─────────────────────────────────────────────────────────────────────────────
# FILTER STATE MACHINE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Filter AST as single source of truth
  `filterStore` holds the parsed AST + serialized `queryText`. The AST is the
  source of truth; sidebar controls and the search bar both project from it.

  Scenario: Sidebar checkbox updates AST, search bar, and URL
    Given `filterStore.ast` is empty
    When the user checks "error" under the Status facet
    Then `filterStore.toggleFacet("status","error")` updates `ast` + `queryText` synchronously
    And the search bar text reflects the change immediately (it subscribes to `queryText`)
    And `useURLSync` writes the new fragment on its 150 ms timer
    And `useDebouncedFilterCommit` calls `commitDebounced` after 300 ms of inactivity, which writes `debouncedQueryText`

  Scenario: Search bar edit updates AST, sidebar, and URL
    Given `filterStore.ast` is empty
    When the user types "model:gpt-4o" in the search bar and presses Enter
    Then `applyQueryText` parses, validates, and re-serializes the text
    And the sidebar's model facet shows "gpt-4o" as checked (it reads from `filterStore.ast`)
    And the URL fragment updates within 150 ms

  Scenario: Rapid filter changes debounce network requests
    When the user clicks 3 checkboxes within 200 ms
    Then the AST + `queryText` update 3 times synchronously
    And the search bar reflects each update immediately
    But only ONE refetch fires (300 ms after the final change, when `debouncedQueryText` updates)

  Scenario: Debounce applies to network state only, not visual state
    When the user checks a filter checkbox
    Then `queryText` updates with 0 ms delay
    And the URL fragment updates within 150 ms
    But `tracesV2.list` does NOT see the new filter until `debouncedQueryText` advances at 300 ms

  Scenario: Invalid query keeps the previous debounced filter live
    Given the user has "status:error" applied (debounced)
    When the user types an invalid query and `parseError` is set
    Then `commitDebounced` does NOT advance `debouncedQueryText` (it stays on the last valid value)
    And the trace list keeps showing the previous results

  Scenario: Clear all resets AST and all dependent state
    Given filters are active
    When the user clicks the search bar's clear button (`filterStore.clearAll`)
    Then `ast`, `queryText`, and `parseError` are reset
    And the sidebar unchecks every value
    And the URL fragment is rebuilt without filter overrides
    And the trace list refetches with no filters once the debounce fires


# ─────────────────────────────────────────────────────────────────────────────
# DRAWER DATA (Levels 1-3)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Progressive drawer loading
  The drawer loads data in thin slices as the user drills deeper.

  Scenario: Clicking a trace row opens drawer and seeds + fetches header
    When the user clicks a trace row with traceId "abc123"
    Then `useOpenTraceDrawer` seeds `tracesV2.header` from the row payload
    And the URL updates to `?drawer.open=traceV2Details&drawer.traceId=abc123&drawer.t=<timestamp>`
    And `useTraceHeader` fires `tracesV2.header` (staleTime 5 min, cacheTime 30 min)
    And `useSpanTree` fires `tracesV2.spanTree` (with the `occurredAtMs` partition-pruning hint)
    And `useSpanLangwatchSignals` fires `tracesV2.spanLangwatchSignals` in parallel
    And `tracesV2.spanDetail` does NOT fire (no selected span)

  Scenario: Span tree returns lightweight skeleton only
    When `useSpanTree` fires
    Then `tracesV2.spanTree` returns SpanTreeNode rows: spanId, parentSpanId, name, type, startTimeMs, endTimeMs, durationMs, status, model
    And it does NOT return SpanAttributes, input/output, or Events (those live on `spanDetail`)

  Scenario: Clicking a span fetches full detail
    Given the drawer is open with a trace
    When the user clicks span "span-456" in the waterfall
    Then the URL updates to include `drawer.span=span-456`
    And `useSpanDetail` fires `tracesV2.spanDetail` (staleTime 5 min via prefetch)
    And the response includes full SpanAttributes (input, output, model, error, metrics, params, events)

  Scenario: Trace evaluations load with the drawer
    Given the drawer is open
    Then `useTraceEvaluations` fires `tracesV2.evals` for the trace
    And returns results from `evaluation_runs`

  Scenario: Drawer data is independent of table filters
    Given the drawer is open with `drawer.traceId=abc123` in the URL
    When the user changes a filter in the sidebar
    Then the trace list refetches
    But the drawer header / span tree for "abc123" do NOT refetch (queries are keyed by traceId, not filters)
    And the drawer stays open

  Scenario: Closing drawer does not clear cache
    Given the drawer was open showing trace "abc123"
    When the user closes the drawer
    And reopens the same trace "abc123"
    Then the drawer header renders instantly from TQ cache
    And no new network request fires (within the 5 min staleTime)


# ─────────────────────────────────────────────────────────────────────────────
# PREFETCH ON HOVER
# ─────────────────────────────────────────────────────────────────────────────

Rule: Drawer prefetch
  Drawer data is warmed at click time and around the selected span.

  Scenario: Row click seeds the header cache from the row payload
    When the user clicks a trace row
    Then `useOpenTraceDrawer` calls `utils.tracesV2.header.setData` with a synthesized header from the row item
    And the drawer renders instantly from that seeded value
    And the real `tracesV2.header` request runs in the background to fill in attributes/events

  Scenario: Span detail is prefetched for adjacent spans
    Given the drawer is open with a span selected
    Then `useTraceDrawerScaffold` calls `usePrefetchSpanDetail` for the previous and next spans
    And those prefetches use staleTime 300_000 (5 min)

  # Not yet implemented — there is no row-level mouseenter prefetch trigger.
  @planned
  Scenario: Hover triggers prefetch after delay
    When the user hovers over a trace row for 150ms
    Then trace.header is prefetched for that traceId


# ─────────────────────────────────────────────────────────────────────────────
# LOADING STATES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Loading state behavior
  Never show loading when there is data to display.

  Scenario: First load shows skeleton
    Given no cached trace list data
    When useTraceList is fetching
    Then the component shows a skeleton/loading state

  Scenario: Background refetch shows existing data
    Given the trace list has cached data
    And the data is stale (older than 30s)
    When useTraceList refetches in the background
    Then the component shows the existing cached data
    And a subtle refetch indicator is visible (not a skeleton)
    And when fresh data arrives, it replaces the old data

  Scenario: Error with existing data shows data + indicator
    Given the trace list has cached data
    When a background refetch fails
    Then the component continues showing the cached data
    And a subtle error indicator is visible
    And a retry button is available

  Scenario: Error with no data shows error boundary
    Given no cached trace list data
    When the initial fetch fails
    Then the table error boundary renders
    And shows the domain error message if available
    And shows a retry button


# ─────────────────────────────────────────────────────────────────────────────
# ERROR BOUNDARIES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Per-level error boundaries
  Errors at one level don't crash other levels.

  Scenario: Span detail error does not crash drawer
    Given the drawer is open with waterfall visible
    When useSpanDetail fails with span_not_found
    Then the waterfall remains visible
    And the span detail panel shows "Span data unavailable. [Select different span]"
    And other drawer content is unaffected

  Scenario: Accordion error does not affect other accordions
    Given the events accordion is expanded
    And the evals accordion is expanded
    When useTraceEvents fails
    Then the events accordion shows "Events unavailable. [Retry]"
    And the evals accordion continues working normally

  Scenario: Table error does not crash the page
    When useTraceList fails with clickhouse_unavailable
    Then the table area shows "Database temporarily unavailable. Retrying..."
    And the nav bar, search bar, and sidebar remain functional


# ─────────────────────────────────────────────────────────────────────────────
# DOMAIN ERRORS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Typed domain error handling
  Every error has a kind, and the frontend renders specific messages.

  Scenario: trace_not_found renders actionable message
    When the server returns domainError kind "trace_not_found" with meta traceId "abc"
    Then the error boundary shows "Trace not found"
    And description includes "abc..." truncated
    And action shows "Close drawer"

  Scenario: query_timeout renders with duration
    When the server returns domainError kind "query_timeout" with meta durationMs 5200 and hint "Try narrowing your time range"
    Then the error shows "Query timed out (5.2s)"
    And description shows the hint

  Scenario: filter_parse_error shows inline in search bar
    When the server returns domainError kind "filter_parse_error" with meta position 7 expected "value after field name"
    Then the search bar shows a red underline at character 7
    And a tooltip shows 'expected: "value after field name"'
    And the trace table does NOT clear (previous results stay)
    And the table error boundary does NOT activate

  Scenario: filter_field_unknown suggests valid fields
    When the server returns domainError kind "filter_field_unknown" with field "modle" and knownFields ["model","mode"]
    Then the error shows 'Unknown field: @modle'
    And description shows "Try: @model, @mode"

  Scenario: clickhouse_unavailable retries automatically
    When the server returns domainError kind "clickhouse_unavailable"
    Then TanStack Query retries up to 6 times with backoff
    And the UI shows "Database temporarily unavailable. Retrying..."

  Scenario: User-fixable errors are not retried
    When the server returns domainError kind "time_range_too_wide"
    Then TanStack Query does NOT retry
    And the error shows "Time range too wide" with an action


# ─────────────────────────────────────────────────────────────────────────────
# URL STATE SYNC
# ─────────────────────────────────────────────────────────────────────────────

Rule: URL state synchronization
  Bar state lives in the URL fragment (`#…`). Drawer state lives in `?drawer.*`
  query params. Shareable links and back/forward both work.

  Scenario: Bar state is encoded in the URL fragment
    Given the user has lens "errors", filter "status:error", time range preset "1h", page 2
    Then the URL fragment encodes the active lensId plus an overrides block (query, preset, page)
    And on the default lens with no overrides the fragment is empty (no `#…`)

  Scenario: Opening a drawer adds query params (not fragment)
    When the user clicks trace "abc123"
    Then the URL gains `?drawer.open=traceV2Details&drawer.traceId=abc123&drawer.t=<timestamp>`
    And `useDrawer.openDrawer` calls `router.push` (a history entry is created)

  Scenario: Closing drawer strips drawer.* params
    Given the drawer is open with `drawer.open=traceV2Details` in the URL
    When the user closes the drawer
    Then every `drawer.*` query param is removed
    And another history entry is created

  Scenario: Browser back closes drawer
    Given the user opened the drawer (creating a history entry)
    When the user clicks browser back
    Then the drawer closes
    And the URL no longer contains `drawer.open`

  Scenario: Shared URL restores full state
    Given a URL with fragment `#by-model?q=model%3Agpt-4o&preset=1h` and query `?drawer.open=traceV2Details&drawer.traceId=abc&drawer.span=def&drawer.viz=flame`
    When a user navigates to this URL
    Then `viewStore.activeLensId` is "by-model"
    And `filterStore.queryText` contains "model:gpt-4o"
    And `filterStore.timeRange.presetId` is "1h"
    And the drawer opens for trace "abc" with span "def" selected and viz tab "flame"

  Scenario: Page refresh preserves state
    Given the app is in a specific state with filters and drawer open
    When the user refreshes the page
    Then `useURLSync` rehydrates `filterStore` + `viewStore` from the fragment
    And `useDrawerUrlSync` rehydrates `drawerStore` from `drawer.*` params

  Scenario: Filter changes use replaceState (no history spam)
    When the user types in the search bar
    Then `useURLSync` coalesces fragment writes on a 150ms timer using `history.replaceState`
    And no new browser history entries are created for filter edits


# ─────────────────────────────────────────────────────────────────────────────
# SSE LIVE TAIL
# ─────────────────────────────────────────────────────────────────────────────

Rule: SSE freshness
  SSE drives freshness, not a dedicated Live Tail page. Trace updates flow
  through `useTraceFreshness` and invalidate TanStack Query caches.

  Scenario: SSE connects on the traces page
    When the user opens the Observe page
    Then `useTraceFreshness` mounts `useTraceUpdateListener` for the project
    And `sseStatusStore.sseConnectionState` reflects the SSE state
    And `sseConnectionState === "connected"` disables the newCount poll

  Scenario: trace_summary_updated invalidates list / facets / newCount
    Given the SSE connection is active
    When a `trace_summary_updated` event arrives
    Then `tracesV2.list` is invalidated immediately
    And `tracesV2.newCount` is invalidated immediately
    And `tracesV2.discover` (facets) is invalidated on a coalesced 30 s timer
    And the refresh icon pulses via `refreshUIStore.pulse`

  Scenario: span_stored invalidates the open drawer's spans
    Given the drawer is open for trace "abc"
    When a `span_stored` event arrives whose traceIds include "abc"
    Then `tracesV2.spanTree` and `tracesV2.spanDetail` are invalidated for that trace

  Scenario: SSE drop falls back to polling
    Given `sseStatusStore.sseConnectionState` is not "connected"
    Then `useTraceNewCount` re-enables its polling interval at FAST_MS (5 s)


# ─────────────────────────────────────────────────────────────────────────────
# BATCHING (httpBatchLink)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Batched tRPC requests with skipBatch opt-out
  The tRPC client uses `httpBatchLink` by default. Heavy or independent
  queries opt out via `trpc: { context: { skipBatch: true } }`.

  Scenario: Drawer open batches header and span tree by default
    When the user clicks a trace row
    Then `tracesV2.header` and `tracesV2.spanTree` fire in the same tick
    And they are batched into a single HTTP request unless one opts out

  Scenario: Heavy queries opt out of batching
    Given `useTraceFacets` (`tracesV2.discover`) sets `context.skipBatch=true`
    Then it issues its own HTTP request and never blocks behind the slow `tracesV2.list` query
    And `useTraceEvaluations` does the same for `tracesV2.evals`


# ─────────────────────────────────────────────────────────────────────────────
# CACHE LIFECYCLE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Cache lifecycle management
  TanStack Query manages stale times, garbage collection, and deduplication.

  Scenario: Drawer data survives across open/close cycles
    Given the user opened and closed trace "abc123"
    When the user reopens trace "abc123" within 30 minutes
    Then the drawer renders instantly from cache
    And no network request fires (within GC window)

  Scenario: Eval data refetches more frequently
    Given evals for trace "abc" were fetched 60 seconds ago
    When `useTraceEvaluations` re-mounts
    Then a background refetch fires (30 s staleTime exceeded)
    And previously fetched evals are shown while refetching

  Scenario: Stale trace list triggers background refetch
    Given `tracesV2.list` was fetched 90 seconds ago (stale — staleTime 60_000 ms)
    When a component subscribes to `useTraceListQuery` with the same params
    Then cached data is served immediately
    And a background refetch fires
    And when fresh data arrives, it replaces the stale data


# ─────────────────────────────────────────────────────────────────────────────
# RACE CONDITIONS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Race condition handling
  Concurrent state changes do not produce inconsistent UI.

  Scenario: Filter change while drawer is open
    Given the drawer is open (trace=abc123 in URL)
    When the user changes a filter
    Then the trace list refetches with new filters
    And the URL still contains trace=abc123
    And the drawer stays open with "abc123" data unchanged
    And if "abc123" disappears from the new results, the drawer still stays open

  Scenario: SSE event during filter change debounce
    Given the user just changed a filter (debounce in progress)
    When an SSE event pushes a new trace into the cache
    Then the new trace appears in the list temporarily
    And when the debounced refetch completes, server results replace the cache

  Scenario: Rapid filter toggling
    When the user toggles 5 checkboxes within 200ms
    Then 5 AST mutations fire (synchronous)
    And 5 search bar updates fire (synchronous)
    But only 1 network request fires (after 300ms debounce)
    And the request uses the final filter state

  Scenario: Eventual consistency on SSE-pushed trace
    Given a trace was just pushed via SSE
    When the user clicks it to open the drawer
    And trace_summaries hasn't propagated the data yet
    Then trace.header returns trace_not_found
    And TQ retries once after 1 second
    And if the second attempt succeeds, the drawer renders normally


# ─────────────────────────────────────────────────────────────────────────────
# SECURITY
# ─────────────────────────────────────────────────────────────────────────────

Rule: Security and data isolation
  All queries are tenant-scoped and permission-checked.

  Scenario: TenantId injected server-side
    When any tracesV2 endpoint is called
    Then the TenantId is read from the server session context
    And it is NOT passed from the client
    And every ClickHouse query includes WHERE TenantId = ?

  Scenario: Permission check on every request
    When a user without "traces:view" permission calls tracesV2.list
    Then the request is rejected with FORBIDDEN
    And no ClickHouse query executes

  Scenario: Filter values are sanitized
    When the user submits a filter with SQL injection attempt
    Then the filter AST parser rejects or escapes the value
    And no raw user input reaches ClickHouse SQL
