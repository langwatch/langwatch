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

  @unimplemented
  Scenario: Initial page load fetches trace list
    When the Observe page loads
    Then `useTraceListQuery` fires `api.tracesV2.list.useQuery`
    And the query uses the default time range (last 30 days, presetId="30d")
    And the query passes `sort` from `viewStore.sort` (default `{ columnId: "time", direction: "desc" }`)
    And the query passes page and pageSize from `filterStore`
    And from page 2 onward it passes that page's opaque keyset `cursor`, never an offset
    And it stays disabled until that page's cursor is known
    And the query passes the debounced query text (or undefined when empty)
    And `query.live` is true whenever the time range has a label (rolling preset)

  @unimplemented
  Scenario: Trace list returns I/O preview from trace_summaries
    When the trace list loads
    Then each trace row includes ComputedInput and ComputedOutput
    And these come from trace_summaries, not stored_spans

  @unimplemented
  Scenario: Page change shows previous data while loading
    Given the trace list is showing page 1 with 50 results
    When the user clicks "next page"
    Then `keepPreviousData: true` keeps page 1 visible
    And when page 2 results arrive, they replace page 1

  @unimplemented
  Scenario: Trace list respects stale time
    Given the trace list loaded 30 seconds ago
    When a component re-mounts that uses useTraceListQuery with the same params
    Then no new network request fires — staleTime is 60_000 ms

  @unimplemented
  Scenario: Trace list deduplicates concurrent requests
    Given two components both call useTraceListQuery with the same params
    Then TanStack Query collapses them to a single network request
    And both components receive the same data


# Still not implemented (re-checked 2026-07-29) — there is no
# `useTraceListGrouped` hook and no `tracesV2.listGrouped` endpoint. Lens
# capabilities define grouping modes
# (`by-service`/`by-user`/`by-model`/`by-conversation`) and `viewStore` reshapes
# `sort` client-side, but no server-side grouped query exists. The symbols named
# below are aspirational, not code.
@planned
Rule: Trace list grouped
  Grouped views show traces organized by a dimension.

  Background:
    Given the user is authenticated
    And the active lens has grouping set to "by-service"

  @unimplemented
  Scenario: Grouped list fires only when grouping is not flat
    Given the active lens has grouping "flat"
    Then useTraceListGrouped does NOT fire

  @unimplemented
  Scenario: Grouped list returns groups with aggregates
    When useTraceListGrouped fires
    Then the response contains groups with key, count, avgDuration, totalCost
    And each group contains its trace rows


Rule: New trace count polling
  A poll detects new traces for the "N new traces" banner.

  @unimplemented
  Scenario: Adaptive polling backs off when no new traces arrive
    Given the Observe page is open and SSE is not connected
    Then useTraceNewCount fires immediately at FAST_MS (5s)
    And after BACKOFF_THRESHOLD (3) consecutive zero-count responses the interval steps up to SLOW_MS (30s)
    And after BACKOFF_THRESHOLD * 2 zero-count responses it steps up to IDLE_MS (120s)
    And every poll includes the current filters, time range, and `since` timestamp

  @unimplemented
  Scenario: SSE preempts polling when connected
    Given `sseStatusStore.sseConnectionState` is "connected"
    Then useTraceNewCount disables its `refetchInterval` entirely
    And the count refreshes via the SSE-driven invalidation in `useTraceFreshness`

  @unimplemented
  Scenario: New count reflects current filters
    Given the user has @status:error filter active
    When the poll fires
    Then it counts only new traces matching @status:error


# ─────────────────────────────────────────────────────────────────────────────
# FACETS (Level 0)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Facet counts
  The filter sidebar shows counts for each facet value.

  @unimplemented
  Scenario: Facets load with the trace list
    When the Observe page loads
    Then `useTraceFacets` calls `api.tracesV2.discover.useQuery` (not `tracesV2.facets`)
    And the discover payload returns categorical facets with `topValues` plus range facets
    And the query opts out of tRPC batching via `trpc.context.skipBatch=true`
    And `staleTime` is 0 — the server's SWR cache plus the `discover_updated` SSE
    push are the freshness mechanism, so the client always reads through

  @unimplemented
  Scenario: Sidebar keeps previous facets across project switches
    Given useTraceFacets has data for project A
    When the user switches to project B
    Then `keepPreviousData` is project-blind in TanStack Query
    But the hook tracks the most recent successful project id, so project A's facets are never shown for project B
    And on a cold cache it surfaces an empty array until project B's response lands
    And on a warm localStorage cache it surfaces project B's last known facet shape instead

  # Not yet implemented — cross-facet exclusion isn't wired through the
  # discover endpoint; counts are computed against the full filter.
  @planned
  @unimplemented
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

  @unimplemented
  Scenario: Field name suggestions come from the static registry
    When the user types "mo" in the search bar
    Then field-mode suggestions are filtered from `FIELD_NAMES` (metadata.ts) plus `DYNAMIC_PREFIXES`
    And no extra network request fires for field names

  @unimplemented
  Scenario: Categorical value suggestions reuse the discover payload
    When the user types "model:gpt" in the search bar
    Then the SearchBar's `valueResolver` ranks `useTraceFacets` topValues for the matching facetField
    And returns up to MAX_DYNAMIC_ITEMS (10) matches
    And no extra network request fires

  @unimplemented
  Scenario: Closed-enum values come from FIELD_VALUES
    When the user types "status:" in the search bar
    Then suggestions are pulled from the static `FIELD_VALUES` table (`error`, `warning`, `ok`)

  # `tracesV2.suggest` exists on the router but is not currently called from
  # the SearchBar UI — value suggestions come from the discover payload.
  @planned
  @unimplemented
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

  @unimplemented
  Scenario: Unknown field rejected at parse time
    When the user types "modle:gpt-4o" in the search bar
    Then the editor marks the token as an unknown field (`filter-token-unknown-field`)
    And `translateFilterToClickHouse` rejects it with `FilterFieldUnknownError` if it is committed
    But `validateAst` does NOT reject it — that check only catches a field with no value
    And the trace table does NOT clear (the previous debouncedQueryText keeps driving the list)

  @unimplemented
  Scenario: New field added in one place appears everywhere
    Given a new entry is added to `SEARCH_FIELDS`
    Then the autocomplete dropdown lists it (FIELD_NAMES is derived from the registry)
    And if the field is registered in `FACET_REGISTRY` and grouped in `FACET_GROUPS` the sidebar renders a section
    And the ClickHouse translator picks up the field via `translateFilterToClickHouse`

  @unimplemented
  # `hasSidebar` on a `SEARCH_FIELDS` entry is dead metadata — nothing reads it.
  # The sidebar is driven by `FACET_REGISTRY` + `FACET_GROUPS`.
  Scenario: Sidebar facets driven by registry
    Given a facet registered in `FACET_REGISTRY` with a categorical value type
    Then the sidebar renders checkbox rows for that field
    Given a facet registered in `FACET_REGISTRY` with a range value type
    Then the sidebar renders a range slider for that field
    Given a `SEARCH_FIELDS` entry absent from `FACET_REGISTRY`
    Then the sidebar does NOT render a section (search-only field, e.g. `traceId`, `spanId`, `event`, `eval`)

  @unimplemented
  Scenario: Enum field with static values
    Given `FIELD_VALUES.status = ["error", "warning", "ok"]`
    Then the autocomplete for "status:" shows these three values
    And the sidebar uses them as `FACET_DEFAULTS.status`

  @unimplemented
  Scenario: Enum field with dynamic values
    Given `FIELD_VALUES` does not include `model`
    Then the autocomplete for "model:" pulls top values from the discover payload via `valueResolver`
    And the sidebar checkboxes are populated from `useTraceFacets` counts

  @unimplemented
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

  @unimplemented
  Scenario: Sidebar checkbox updates AST, search bar, and URL
    Given `filterStore.ast` is empty
    When the user checks "error" under the Status facet
    Then `filterStore.toggleFacet("status","error")` updates `ast` + `queryText` synchronously
    And the search bar text reflects the change immediately (it subscribes to `queryText`)
    And `useURLSync` writes the new fragment on its 150 ms timer
    And `useDebouncedFilterCommit` calls `commitDebounced` after 600 ms of inactivity, which writes `debouncedQueryText`

  @unimplemented
  Scenario: Search bar edit updates AST, sidebar, and URL
    Given `filterStore.ast` is empty
    When the user types "model:gpt-4o" in the search bar and presses Enter
    Then `applyQueryText` parses, validates, and re-serializes the text
    And the sidebar's model facet shows "gpt-4o" as checked (it reads from `filterStore.ast`)
    And the URL fragment updates within 150 ms

  @unimplemented
  Scenario: Rapid filter changes debounce network requests
    When the user clicks 3 checkboxes within 200 ms
    Then the AST + `queryText` update 3 times synchronously
    And the search bar reflects each update immediately
    But only ONE refetch fires (600 ms after the final change, when `debouncedQueryText` updates)

  @unimplemented
  Scenario: Debounce applies to network state only, not visual state
    When the user checks a filter checkbox
    Then `queryText` updates with 0 ms delay
    And the URL fragment updates within 150 ms
    But `tracesV2.list` does NOT see the new filter until `debouncedQueryText` advances at 600 ms

  @unimplemented
  Scenario: Invalid query keeps the previous debounced filter live
    Given the user has "status:error" applied (debounced)
    When the user types an invalid query and `parseError` is set
    Then `commitDebounced` does NOT advance `debouncedQueryText` (it stays on the last valid value)
    And the trace list keeps showing the previous results

  @unimplemented
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

  @unimplemented
  Scenario: Clicking a trace row opens drawer and seeds + fetches header
    When the user clicks a trace row with traceId "abc123"
    Then `useOpenTraceDrawer` seeds `tracesV2.header` from the row payload
    And the URL updates to `?drawer.open=traceV2Details&drawer.traceId=abc123&drawer.t=<timestamp>`
    And `useTraceHeader` fires `tracesV2.header` (staleTime 5 min, cacheTime 30 min)
    And `useSpanTree` starts loading the span tree page by page (forwarding the `occurredAtMs` partition-pruning hint)
    And `useSpanLangwatchSignals` fires `tracesV2.spanLangwatchSignals` in parallel
    And `tracesV2.spanDetail` does NOT fire (no selected span)

  @unimplemented
  Scenario: Span tree returns lightweight skeleton only
    When `useSpanTree` fires
    Then the span tree is returned as SpanTreeNode rows: spanId, parentSpanId, name, type, startTimeMs, endTimeMs, durationMs, status, model
    And it does NOT return SpanAttributes, input/output, or Events (those live on `spanDetail`)

  @unit
  Scenario: Span tree is fetched in cursor pages, never as one response
    Given a trace with more spans than one page
    When `useSpanTree` fires
    Then the client fetches the tree page by page via `tracesV2.spanTreePaginated`
    And each page's `nextCursor` keys the next page, so concurrent ingestion cannot skip or duplicate spans
    And already-fetched spans render in the waterfall while later pages are still loading
    And no span endpoint returns every span of the trace in a single unbounded response

  @integration
  Scenario: Pagination reaches spans recorded long after the trace began
    Given a long-running trace whose newest spans started days after its first span
    When the client pages through the span tree
    Then every span is returned, including those far past the trace's recorded start
    And no page ends the walk early because of a time-window guess

  @integration
  Scenario: Finishing pagination never widens into an unbounded storage scan
    Given a trace whose span count is an exact multiple of the page size
    When the client fetches the final page
    Then the walk terminates without an extra empty fetch
    And the storage read never widens beyond the pages' own time bounds

  @unit
  Scenario: Live fallback polling fetches only what changed
    Given an open live trace whose realtime connection is down
    When the periodic fallback refresh fires
    Then only spans changed since the newest already-loaded change are requested
    And they are merged into the loaded tree in place
    And the full page walk does not rerun on every poll

  @unimplemented
  Scenario: A span that is updated in place is picked up by the live refresh
    Given an open live trace whose realtime connection is down
    And a span already in the loaded tree finishes, changing its duration and status
    When the periodic fallback refresh fires
    Then that span's new duration and status are shown
    And this holds for the root span, which starts before every other span and ends after them

  @unimplemented
  Scenario: Realtime span updates do not re-walk the whole trace
    Given an open live trace with 100,000+ spans and a healthy realtime connection
    When a batch of new spans is recorded
    Then only the changed spans are requested
    And the client does not restart the page walk

  @unit
  Scenario: Reconnecting picks up whatever was missed
    Given an open live trace whose realtime connection was down and has just come back
    When no further span is recorded
    Then any span that changed between the last poll and the reconnect is still picked up

  @unit
  Scenario: A page never shows a superseded version of a span
    Given a span was recorded twice, the newer version correcting its start time to be earlier
    When the client pages past the point where the correction landed
    Then the page shows the newer version of that span, never the superseded one

  @unimplemented
  Scenario: A huge trace cannot exhaust server memory through per-trace span reads
    Given a runaway trace with 100,000+ spans
    When any per-trace read fires (span tree, signals, resource info, trace events, live deltas)
    Then the read is bounded server-side and returns at most a fixed ceiling of rows
    And the complete span tree remains reachable through the cursor-paged fetch

  @unimplemented
  Scenario: Clicking a span fetches full detail
    Given the drawer is open with a trace
    When the user clicks span "span-456" in the waterfall
    Then the URL updates to include `drawer.span=span-456`
    And `useSpanDetail` fires `tracesV2.spanDetail` (staleTime 5 min via prefetch)
    And the response includes full SpanAttributes (input, output, model, error, metrics, params, events)

  @unimplemented
  Scenario: Trace evaluations load with the drawer
    Given the drawer is open
    Then `useTraceEvaluations` fires the v1 `traces.getEvaluations` for the trace
    And `tracesV2.evals` exists on the router but is NOT yet the drawer's source

  @unimplemented
  Scenario: Drawer data is independent of table filters
    Given the drawer is open with `drawer.traceId=abc123` in the URL
    When the user changes a filter in the sidebar
    Then the trace list refetches
    But the drawer header / span tree for "abc123" do NOT refetch (queries are keyed by traceId, not filters)
    And the drawer stays open

  @unimplemented
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

  @unimplemented
  Scenario: Row click seeds the header cache from the row payload
    When the user clicks a trace row
    Then `useOpenTraceDrawer` calls `utils.tracesV2.header.setData` with a synthesized header from the row item
    And the drawer renders instantly from that seeded value
    And the real `tracesV2.header` request runs in the background to fill in attributes/events

  @unimplemented
  Scenario: Span detail is prefetched for adjacent spans
    Given the drawer is open with a span selected
    Then `useTraceDrawerScaffold` calls `usePrefetchSpanDetail` for the previous and next spans
    And those prefetches use staleTime 300_000 (5 min)

  # Not yet implemented — there is no row-level mouseenter prefetch trigger.
  @planned
  @unimplemented
  Scenario: Hover triggers prefetch after delay
    When the user hovers over a trace row for 150ms
    Then trace.header is prefetched for that traceId


# ─────────────────────────────────────────────────────────────────────────────
# LOADING STATES
# ─────────────────────────────────────────────────────────────────────────────

Rule: Loading state behavior
  Never show loading when there is data to display.

  @unimplemented
  Scenario: First load shows skeleton
    Given no cached trace list data
    When useTraceList is fetching
    Then the component shows a skeleton/loading state

  @unimplemented
  Scenario: Background refetch shows existing data
    Given the trace list has cached data
    And the data is stale (older than 30s)
    When useTraceList refetches in the background
    Then the component shows the existing cached data
    And a subtle refetch indicator is visible (not a skeleton)
    And when fresh data arrives, it replaces the old data

  @unimplemented
  Scenario: Error with existing data shows data + indicator
    Given the trace list has cached data
    When a background refetch fails
    Then the component continues showing the cached data
    And a subtle error indicator is visible
    And a retry button is available

  @unimplemented
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

  @unimplemented
  Scenario: Span detail error does not crash drawer
    Given the drawer is open with waterfall visible
    When the span detail read fails with span_not_found
    Then the waterfall remains visible
    And other drawer content is unaffected
    And the span detail panel says the span was not found
    And it says the span may have been deleted along with its trace
    And it offers a way back to choosing another span
    But it offers no retry, because a missing span stays missing
    And the customer never reads the raw wire message

  # A span outside the viewer's visibility window is NOT absent. The gate
  # redacts its content and hands it back, so the customer sees a span whose
  # detail is withheld — which is what tells them there is something there to
  # unlock. Reporting it as missing would both lie and remove the upsell.
  # Only a span that genuinely is not there reads as not found.
  @unimplemented
  Scenario: A span outside the visibility window is withheld, not reported missing
    Given the drawer is open with waterfall visible
    And the selected span falls outside the viewer's visibility window
    When the span detail read runs
    Then the span detail panel renders the span with its content withheld
    And the panel does not say the span was not found

  @unimplemented
  Scenario: A span that is genuinely gone is the only case that reads as not found
    Given the drawer is open with waterfall visible
    And the selected span no longer exists
    When the span detail read runs
    Then the span detail panel says the span was not found

  @integration
  Scenario: Span detail error we cannot name still explains itself
    Given the drawer is open with a span selected
    When the span detail read fails with no handled error code
    Then the span detail panel says it could not load this span
    And it offers a retry
    And the customer never reads the raw wire message

  @unimplemented
  Scenario: Accordion error does not affect other accordions
    Given the events accordion is expanded
    And the evals accordion is expanded
    When useTraceEvents fails
    Then the events accordion shows "Events unavailable. [Retry]"
    And the evals accordion continues working normally

  @unimplemented
  Scenario: Table error does not crash the page
    When useTraceList fails with clickhouse_unavailable
    Then the table area shows "Database temporarily unavailable. Retrying..."
    And the nav bar, search bar, and sidebar remain functional


# ─────────────────────────────────────────────────────────────────────────────
# DOMAIN ERRORS
# ─────────────────────────────────────────────────────────────────────────────

Rule: Typed domain error handling
  Every failure a customer can act on carries a stable `HandledError` code. The
  client renders copy from the code-keyed presentation registry
  (`features/errors/logic/presentation.ts`), never the wire message — tRPC
  collapses that to the code slug. The registry prose is fixed: a scenario that
  wants server `meta` interpolated into the words is asking for something the
  registry does not currently do.

  @unimplemented
  Scenario: trace_not_found renders actionable message
    When the server raises the handled code "trace_not_found" for trace "abc"
    Then the drawer's empty state shows "Trace not found"
    And it offers a "Close drawer" action
    And the trace id is NOT echoed into the description — the registry copy is fixed prose

  @unimplemented
  Scenario: query_timeout renders with duration
    When the server raises the handled code "query_timeout"
    Then the error shows the registry title "This search took too long"
    And the description tells the customer to narrow the time range
    And neither the elapsed duration nor a server-supplied hint is rendered

  @unimplemented
  Scenario: filter_parse_error shows inline in search bar
    When a filter fails to parse
    Then the search bar shows a dismissible inline error banner
    And the trace table does NOT clear (previous results stay)
    And the table error boundary does NOT activate
    And the server code "filter_parse_error" renders registry prose, with no caret position

  @unimplemented
  Scenario: filter_field_unknown suggests valid fields
    When the server raises the handled code "filter_field_unknown" with meta field "modle"
    Then the error shows the registry title "Unknown filter field"
    And the description names the offending field back to the customer
    And no "did you mean" suggestion list is offered — `knownFields` is not rendered

  @unimplemented
  Scenario: clickhouse_unavailable retries automatically
    When the server raises the handled code "clickhouse_unavailable" (503)
    Then TanStack Query retries it — retry is keyed on HTTP status, and 503 is not in the no-retry list
    And it gives up after MAX_RETRIES (4) attempts
    And the table surfaces that it is retrying rather than rendering an empty result

  @unimplemented
  Scenario: User-fixable errors are not retried
    When the server raises the handled code "query_memory_exceeded" (422)
    Then TanStack Query does NOT retry — 422 is in HTTP_STATUS_TO_NOT_RETRY
    And the error shows the registry copy "This search was too large"


# ─────────────────────────────────────────────────────────────────────────────
# URL STATE SYNC
# ─────────────────────────────────────────────────────────────────────────────

Rule: URL state synchronization
  Bar state lives in the URL fragment (`#…`). Drawer state lives in `?drawer.*`
  query params. Shareable links and back/forward both work.

  @unimplemented
  Scenario: Bar state is encoded in the URL fragment
    Given the user has lens "errors", filter "status:error", time range preset "1h", page 2
    Then the URL fragment encodes the active lensId plus an overrides block (query, preset, page)
    And on the default lens with no overrides the fragment is empty (no `#…`)

  @unimplemented
  Scenario: Opening a drawer adds query params (not fragment)
    When the user clicks trace "abc123"
    Then the URL gains `?drawer.open=traceV2Details&drawer.traceId=abc123&drawer.t=<timestamp>`
    And `useDrawer.openDrawer` calls `router.push` (a history entry is created)

  @unimplemented
  Scenario: Closing drawer strips drawer.* params
    Given the drawer is open with `drawer.open=traceV2Details` in the URL
    When the user closes the drawer
    Then every `drawer.*` query param is removed
    And another history entry is created

  @unimplemented
  Scenario: Browser back closes drawer
    Given the user opened the drawer (creating a history entry)
    When the user clicks browser back
    Then the drawer closes
    And the URL no longer contains `drawer.open`

  @unimplemented
  Scenario: Shared URL restores full state
    Given a URL with fragment `#by-model?q=model%3Agpt-4o&preset=1h` and query `?drawer.open=traceV2Details&drawer.traceId=abc&drawer.span=def&drawer.viz=flame`
    When a user navigates to this URL
    Then `viewStore.activeLensId` is "by-model"
    And `filterStore.queryText` contains "model:gpt-4o"
    And `filterStore.timeRange.presetId` is "1h"
    And the drawer opens for trace "abc" with span "def" selected and viz tab "flame"

  @unimplemented
  Scenario: Page refresh preserves state
    Given the app is in a specific state with filters and drawer open
    When the user refreshes the page
    Then `useURLSync` rehydrates `filterStore` + `viewStore` from the fragment
    And `useDrawerUrlSync` rehydrates `drawerStore` from `drawer.*` params

  @unimplemented
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

  @unimplemented
  Scenario: SSE connects on the traces page
    When the user opens the Observe page
    Then `useTraceFreshness` mounts `useTraceUpdateListener` for the project
    And `sseStatusStore.sseConnectionState` reflects the SSE state
    And `sseConnectionState === "connected"` disables the newCount poll

  @unimplemented
  Scenario: trace_summary_updated invalidates list / facets / newCount
    Given the SSE connection is active
    When a `trace_summary_updated` event arrives
    Then `tracesV2.list` is invalidated only when the updated trace is not already visible on the current page
    And `tracesV2.newCount` is invalidated on a coalesced 10 s timer — once per burst, not once per event
    And `tracesV2.discover` (facets) is invalidated on a coalesced 30 s timer
    And an already-visible row pulses via `rowPulseStore.pulse` instead

  @unimplemented
  Scenario: span_stored invalidates the open drawer's spans
    Given the drawer is open for trace "abc"
    When a `span_stored` event arrives whose traceIds include "abc"
    Then `tracesV2.spanTreeDelta`, `spanDetail`, `spanLangwatchSignals`, `traceEvents` and `resourceInfo` are invalidated for that trace
    But `tracesV2.spanTree` is deliberately NOT invalidated — that would re-run the whole page walk

  @unimplemented
  Scenario: SSE drop falls back to polling
    Given `sseStatusStore.sseConnectionState` is not "connected"
    Then `useTraceNewCount` re-enables its polling interval at FAST_MS (5 s)


# ─────────────────────────────────────────────────────────────────────────────
# BATCHING (httpBatchLink)
# ─────────────────────────────────────────────────────────────────────────────

Rule: Batched tRPC requests with skipBatch opt-out
  The tRPC client uses `httpBatchLink` by default. Heavy or independent
  queries opt out via `trpc: { context: { skipBatch: true } }`.

  @unimplemented
  Scenario: Drawer open batches header and span tree by default
    When the user clicks a trace row
    Then `tracesV2.header` and the first `tracesV2.spanTreePaginated` page fire in the same tick
    And they are batched into a single HTTP request unless one opts out

  @unimplemented
  Scenario: Heavy queries opt out of batching
    Given `useTraceFacets` (`tracesV2.discover`) sets `context.skipBatch=true`
    Then it issues its own HTTP request and never blocks behind the slow `tracesV2.list` query
    And `useTraceEvaluations` does the same for its evaluations query


# ─────────────────────────────────────────────────────────────────────────────
# CACHE LIFECYCLE
# ─────────────────────────────────────────────────────────────────────────────

Rule: Cache lifecycle management
  TanStack Query manages stale times, garbage collection, and deduplication.

  @unimplemented
  Scenario: Drawer data survives across open/close cycles
    Given the user opened and closed trace "abc123"
    When the user reopens trace "abc123" within 30 minutes
    Then the drawer renders instantly from cache
    And no network request fires (within GC window)

  @unimplemented
  Scenario: Eval data refetches more frequently
    Given evals for trace "abc" were fetched 60 seconds ago
    When `useTraceEvaluations` re-mounts
    Then a background refetch fires (30 s staleTime exceeded)
    And previously fetched evals are shown while refetching

  @unimplemented
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

  @unimplemented
  Scenario: Filter change while drawer is open
    Given the drawer is open (trace=abc123 in URL)
    When the user changes a filter
    Then the trace list refetches with new filters
    And the URL still contains trace=abc123
    And the drawer stays open with "abc123" data unchanged
    And if "abc123" disappears from the new results, the drawer still stays open

  @unimplemented
  Scenario: SSE event during filter change debounce
    Given the user just changed a filter (debounce in progress)
    When an SSE event pushes a new trace into the cache
    Then the new trace appears in the list temporarily
    And when the debounced refetch completes, server results replace the cache

  @unimplemented
  Scenario: Rapid filter toggling
    When the user toggles 5 checkboxes within 200ms
    Then 5 AST mutations fire (synchronous)
    And 5 search bar updates fire (synchronous)
    But only 1 network request fires (after the 600 ms query-text debounce)
    And the request uses the final filter state

  @unimplemented
  Scenario: Eventual consistency on SSE-pushed trace
    Given a trace was just pushed via SSE
    When the user clicks it to open the drawer
    And trace_summaries hasn't propagated the data yet
    Then trace.header raises the handled code "trace_not_found"
    And TanStack Query does NOT retry it — 404 is in HTTP_STATUS_TO_NOT_RETRY
    And the drawer shows the trace-not-found empty state rather than silently recovering


# ─────────────────────────────────────────────────────────────────────────────
# SECURITY
# ─────────────────────────────────────────────────────────────────────────────

Rule: Security and data isolation
  All queries are tenant-scoped and permission-checked.

  @unimplemented
  Scenario: TenantId injected server-side
    When any tracesV2 endpoint is called
    Then the client names the project and `checkProjectPermission` proves the caller may read it
    And the checked `input.projectId` is what flows downstream as TenantId
    And every ClickHouse query includes WHERE TenantId = ?

  @unimplemented
  Scenario: Permission check on every request
    When a user without "traces:view" permission calls tracesV2.list
    Then the request is rejected with FORBIDDEN
    And no ClickHouse query executes

  @unimplemented
  Scenario: Filter values are sanitized
    When the user submits a filter with SQL injection attempt
    Then the filter AST parser rejects or escapes the value
    And no raw user input reaches ClickHouse SQL
