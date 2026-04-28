# Data Layer — Gherkin Spec
# Based on PRD-022: Data Layer
# Covers: state management, data fetching, caching, errors, loading states, URL sync

# ─────────────────────────────────────────────────────────────────────────────
# TRACE LIST (Level 0)
# ─────────────────────────────────────────────────────────────────────────────

Feature: Trace list data fetching
  The trace table fetches paginated, filtered, sorted data from trace_summaries.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the project has traces in ClickHouse

  Scenario: Initial page load fetches trace list
    When the Observe page loads
    Then useTraceList fires a query to tracesV2.list
    And the query includes the default time range "last 24 hours"
    And the query includes the active lens's visible columns
    And the query includes sort by "time desc"
    And the query includes page 1, pageSize 50
    And the query hits trace_summaries only (no span joins)

  Scenario: Trace list returns I/O preview from trace_summaries
    When the trace list loads
    Then each trace row includes ComputedInput and ComputedOutput
    And these come from trace_summaries, not stored_spans

  Scenario: Page change shows previous data while loading
    Given the trace list is showing page 1 with 50 results
    When the user clicks "next page"
    Then page 1 results remain visible
    And a subtle refetch indicator appears
    And when page 2 results arrive, they replace page 1

  Scenario: Trace list respects stale time
    Given the trace list loaded 20 seconds ago
    When a component re-mounts that uses useTraceList with the same params
    Then no new network request fires (data is still fresh within 30s stale time)

  Scenario: Trace list deduplicates concurrent requests
    Given two components both call useTraceList with the same params
    Then only one network request fires
    And both components receive the same data


Feature: Trace list grouped
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


Feature: New trace count polling
  A poll detects new traces for the "N new traces" banner.

  Scenario: Polls every 30 seconds
    Given the Observe page is open
    Then useTraceNewCount fires immediately
    And refires every 30 seconds
    And includes the current filters and time range
    And includes a "since" timestamp of the latest loaded trace

  Scenario: New count reflects current filters
    Given the user has @status:error filter active
    When the poll fires
    Then it counts only new traces matching @status:error


# ─────────────────────────────────────────────────────────────────────────────
# FACETS (Level 0)
# ─────────────────────────────────────────────────────────────────────────────

Feature: Facet counts
  The filter sidebar shows counts for each facet value.

  Scenario: Facets load with the trace list
    When the Observe page loads
    Then useTraceFacets fires alongside useTraceList
    And returns counts for: origin, status, span type, model, service

  Scenario: Cross-facet filtering excludes own filter
    Given the user has checked "error" in the Status facet
    When facets refresh
    Then the Status facet still shows counts for "warning" and "ok"
    And the Status counts are calculated WITHOUT the status filter
    And all other facets include the status:error filter

  Scenario: Facet degradation on slow query
    Given a facet COUNT query takes longer than 500ms
    Then the sidebar shows stale counts from the previous result
    And a background refresh continues silently
    And when fresh counts arrive, they replace the stale ones


# ─────────────────────────────────────────────────────────────────────────────
# SEARCH AUTOCOMPLETE (Level 0)
# ─────────────────────────────────────────────────────────────────────────────

Feature: Search autocomplete
  The search bar suggests field names and values.

  Scenario: Field name suggestions
    When the user types "@mo" in the search bar
    Then useSearchAutocomplete fires with field="" prefix="mo"
    And returns matching fields: "@model"

  Scenario: Field value suggestions
    When the user types "@model:gpt"
    Then useSearchAutocomplete fires with field="model" prefix="gpt"
    And returns matching values from trace_summaries Models array

  Scenario: Autocomplete does not fire on empty prefix
    When the user has typed "@" but no characters after it
    Then useSearchAutocomplete does NOT fire (enabled: false)

  Scenario: Autocomplete uses long stale time
    Given suggestions for "@model:" were fetched 3 minutes ago
    When the user types "@model:" again
    Then cached results are served (5min stale time)


# ─────────────────────────────────────────────────────────────────────────────
# FILTER FIELD REGISTRY (strongly typed)
# ─────────────────────────────────────────────────────────────────────────────

Feature: Strongly typed filter field registry
  Every filterable field is defined once. The registry drives autocomplete,
  sidebar facets, AST validation, and ClickHouse query translation.

  Scenario: Unknown field rejected at parse time
    When the user types "@modle:gpt-4o" in the search bar
    Then the AST parser rejects it with FilterFieldUnknownError
    And the error includes knownFields: ["model", "mode", ...]
    And the search bar shows an inline error
    And the trace table does NOT clear

  Scenario: Field type validated at parse time
    When the user types "@status:>5" (range operator on an enum field)
    Then the AST parser rejects it with FilterParseError
    And the error says the status field only accepts enum values

  Scenario: New field added in one place appears everywhere
    Given a new field "topic" is added to FILTER_FIELDS
    Then the search bar autocomplete includes @topic
    And the sidebar renders a facet for it (based on facet type)
    And the ClickHouse query builder handles @topic filters
    And the AST parser accepts @topic:value

  Scenario: Sidebar facets driven by registry
    Given FILTER_FIELDS defines status with facet "checkbox"
    And FILTER_FIELDS defines cost with facet "range"
    And FILTER_FIELDS defines user with facet "hidden"
    Then the sidebar renders checkboxes for status
    And the sidebar renders a range slider for cost
    And the sidebar does NOT render a facet for user (search-only)

  Scenario: Enum field with static values
    Given FILTER_FIELDS defines status with values ["error", "warning", "ok"]
    Then the autocomplete for @status: shows these three values
    And the sidebar checkboxes show these three values

  Scenario: Enum field with dynamic values
    Given FILTER_FIELDS defines model with no static values
    Then the autocomplete for @model: fetches values from useSearchAutocomplete
    And the sidebar checkboxes are populated from useTraceFacets counts

  Scenario: Range field validates numeric input
    When the user types "@cost:abc"
    Then the AST parser rejects it (cost expects a number or range expression)

  Scenario: Glob/prefix match on supported fields
    When the user types "@model:gpt*"
    Then the AST parses it as field "model" operator "like" value "gpt*"
    And the ClickHouse translation uses arrayExists with LIKE


# ─────────────────────────────────────────────────────────────────────────────
# FILTER STATE MACHINE
# ─────────────────────────────────────────────────────────────────────────────

Feature: Filter AST as single source of truth
  All filter state flows through the AST. No two-way sync.

  Scenario: Sidebar checkbox updates AST, search bar, and URL
    Given the filter AST is empty
    When the user checks "error" in the Status sidebar facet
    Then the filterStore AST is updated to include @status:error
    And the search bar text updates to "@status:error" (synchronous)
    And the URL updates to include q=@status:error (synchronous)
    And a TQ refetch is debounced (fires after 300ms of inactivity)

  Scenario: Search bar edit updates AST, sidebar, and URL
    Given the filter AST is empty
    When the user types "@model:gpt-4o" in the search bar and presses Enter
    Then the filterStore AST is updated to include @model:gpt-4o
    And the sidebar model facet shows "gpt-4o" as checked (synchronous)
    And the URL updates to include the query (synchronous)

  Scenario: Rapid filter changes debounce network requests
    When the user clicks 3 checkboxes within 200ms
    Then the AST updates 3 times (synchronous, instant)
    And the search bar updates 3 times (synchronous, instant)
    But only ONE network request fires (after 300ms of no further changes)
    And it uses the final AST state

  Scenario: Debounce applies to TQ only, not to UI
    When the user checks a filter checkbox
    Then the search bar text updates immediately (0ms delay)
    And the sidebar checkbox state updates immediately
    And the URL updates immediately
    But the trace.list query does NOT fire until 300ms later

  Scenario: Clear all resets AST and all dependent state
    Given filters are active
    When the user clicks "Clear all"
    Then the AST is set to empty
    And the search bar clears
    And the sidebar unchecks everything
    And the URL removes the q param
    And the trace list refetches with no filters


# ─────────────────────────────────────────────────────────────────────────────
# DRAWER DATA (Levels 1-3)
# ─────────────────────────────────────────────────────────────────────────────

Feature: Progressive drawer loading
  The drawer loads data in thin slices as the user drills deeper.

  Scenario: Clicking a trace row opens drawer and fetches header + span skeleton
    When the user clicks a trace row with traceId "abc123"
    Then the URL updates to include trace=abc123
    And useTraceHeader fires reading traceId from the URL param (staleTime 5min)
    And useSpanSummary fires reading traceId from the URL param (staleTime 5min)
    And useSpanDetail does NOT fire (no span param in URL)
    And useTraceEvents does NOT fire (accordion closed, component-local state)
    And useTraceEvals does NOT fire (accordion closed, component-local state)

  Scenario: Span summary returns lightweight skeleton only
    When useSpanSummary fires for a trace
    Then it returns: SpanId, ParentSpanId, SpanName, DurationMs, StatusCode, spanType, model, StartTime
    And it does NOT return: langwatch.input, langwatch.output, SpanAttributes, Events

  Scenario: Clicking a span fetches full detail
    Given the drawer is open with a trace
    When the user clicks span "span-456" in the waterfall
    Then the URL updates to include span=span-456
    And useSpanDetail fires reading spanId from the URL param
    And the response includes full SpanAttributes (input, output, model, etc.)

  Scenario: Expanding events accordion fetches events
    Given the drawer is open
    And the events accordion is collapsed
    When the user expands the events accordion
    Then component-local eventsExpanded state is set to true
    And useTraceEvents fires (enabled by local state)
    And returns events from stored_spans Events arrays

  Scenario: Expanding evals accordion fetches evaluations
    Given the drawer is open
    And the evals accordion is collapsed
    When the user expands the evals accordion
    Then component-local evalsExpanded state is set to true
    And useTraceEvals fires (enabled by local state)
    And returns results from evaluation_runs

  Scenario: Evals use shorter stale time
    Given evals were fetched 45 seconds ago
    When the evals accordion is collapsed and re-expanded
    Then cached results are served (within 60s stale time)

  Scenario: Drawer data is independent of table filters
    Given the drawer is open (trace=abc123 in URL)
    When the user changes a filter in the sidebar
    Then the trace list refetches
    But the drawer data for "abc123" does NOT refetch (keyed by traceId, not filters)
    And the URL still contains trace=abc123
    And the drawer stays open

  Scenario: Closing drawer does not clear cache
    Given the drawer was open showing trace "abc123"
    When the user closes the drawer
    And reopens the same trace "abc123"
    Then the drawer header renders instantly from TQ cache
    And no new network request fires (within stale time)


# ─────────────────────────────────────────────────────────────────────────────
# PREFETCH ON HOVER
# ─────────────────────────────────────────────────────────────────────────────

Feature: Hover prefetch for instant drawer opens
  Hovering a trace row prefetches its drawer data.

  Scenario: Hover triggers prefetch after delay
    When the user hovers over a trace row for 150ms
    Then trace.header is prefetched for that traceId
    And span.summary is prefetched for that traceId

  Scenario: Quick hover does not prefetch
    When the user hovers over a trace row for 100ms and moves away
    Then no prefetch fires (150ms threshold not met)

  Scenario: Prefetch deduplicates with actual fetch
    Given the user hovered row "abc" and prefetch completed
    When the user clicks row "abc" to open the drawer
    Then the drawer renders instantly from prefetched cache
    And no new network request fires


# ─────────────────────────────────────────────────────────────────────────────
# LOADING STATES
# ─────────────────────────────────────────────────────────────────────────────

Feature: Loading state behavior
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

Feature: Per-level error boundaries
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

Feature: Typed domain error handling
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

Feature: URL state synchronization
  App state is serialized to URL. Shareable links. Back/forward works.

  Scenario: URL reflects current state
    Given the user has lens "errors", filter "@status:error", time range "last 1 hour", page 2
    Then the URL contains lens=errors&q=@status:error&from=now-1h&to=now&page=2

  Scenario: Opening a drawer adds to URL
    When the user clicks trace "abc123"
    Then the URL adds trace=abc123
    And a browser history entry is created (pushState)

  Scenario: Closing drawer removes from URL
    Given the drawer is open with trace=abc123 in the URL
    When the user closes the drawer
    Then trace= is removed from the URL
    And a browser history entry is created

  Scenario: Browser back closes drawer
    Given the user opened the drawer (creating a history entry)
    When the user clicks browser back
    Then the drawer closes
    And the URL no longer contains trace=

  Scenario: Shared URL restores full state
    Given a URL /traces?lens=by-model&q=@model:gpt-4o&from=now-1h&to=now&trace=abc&span=def&viz=flame
    When a user navigates to this URL
    Then viewStore.activeLensId is "by-model"
    And filterStore.ast contains @model:gpt-4o
    And filterStore.timeRange is last 1 hour
    And the drawer opens for trace "abc" (read from URL param)
    And span "def" is selected (read from URL param)
    And viz tab is "flame" (read from URL param)

  Scenario: Page refresh preserves state
    Given the app is in a specific state with filters and drawer open
    When the user refreshes the page
    Then all stores are rehydrated from the URL
    And the app restores to the same visual state

  Scenario: Filter changes use replaceState (no history spam)
    When the user toggles 5 filter checkboxes rapidly
    Then the URL updates 5 times via replaceState
    And no browser history entries are created
    And browser back does NOT undo individual filter changes


# ─────────────────────────────────────────────────────────────────────────────
# SSE LIVE TAIL
# ─────────────────────────────────────────────────────────────────────────────

Feature: Live tail via SSE
  Real-time trace streaming on the Live Tail page.

  Scenario: SSE connects when Live Tail page opens
    When the user navigates to the Live Tail page
    Then useLiveTail enables with the current filters
    And an SSE connection is established via the existing sseLink

  Scenario: New traces push into the query cache
    Given the SSE connection is active
    When a new trace arrives via SSE
    Then it is prepended to the trace.list cache
    And the trace appears at the top of the live tail list

  Scenario: SSE buffer limit
    Given 500 traces are in the live tail buffer
    When a new trace arrives via SSE
    Then the oldest trace is dropped from the buffer
    And the buffer size stays at 500

  Scenario: SSE respects server-side filters
    Given the user has @status:error filter active on Live Tail
    Then only traces matching @status:error are sent over SSE
    And non-matching traces are filtered server-side (not client-side)

  Scenario: SSE reconnects on connection drop
    Given the SSE connection drops
    Then the existing sseLink reconnects with exponential backoff
    And up to 5 reconnection attempts are made

  Scenario: SSE disconnects when leaving Live Tail
    Given the SSE connection is active
    When the user navigates away from Live Tail
    Then the SSE connection is closed
    And no background resource usage continues


# ─────────────────────────────────────────────────────────────────────────────
# STREAMING (httpBatchStreamLink)
# ─────────────────────────────────────────────────────────────────────────────

Feature: Streamed batch responses
  Multiple queries batch into one HTTP request with JSON-L streaming.

  Scenario: Drawer open batches header and span summary
    When the user clicks a trace row
    Then trace.header and span.summary fire in the same render cycle
    And they are batched into a single HTTP request
    And the server returns JSON-L: header first, then spans

  Scenario: Header renders before spans arrive
    Given a drawer-open batch request is in flight
    When the trace.header response streams back first
    Then the drawer header renders immediately
    And the waterfall area shows a skeleton
    And when span.summary streams back, the waterfall renders


# ─────────────────────────────────────────────────────────────────────────────
# CACHE LIFECYCLE
# ─────────────────────────────────────────────────────────────────────────────

Feature: Cache lifecycle management
  TanStack Query manages stale times, garbage collection, and deduplication.

  Scenario: Drawer data survives across open/close cycles
    Given the user opened and closed trace "abc123"
    When the user reopens trace "abc123" within 30 minutes
    Then the drawer renders instantly from cache
    And no network request fires (within GC window)

  Scenario: Eval data refetches more frequently
    Given evals for trace "abc" were fetched 90 seconds ago
    When the evals accordion is re-expanded
    Then a background refetch fires (60s stale time exceeded)
    And previously fetched evals are shown while refetching

  Scenario: Cache is garbage collected after GC window
    Given span.detail for "span-123" was fetched 35 minutes ago
    And no component is subscribed to that query
    Then TanStack Query drops the cached data (30min GC)
    And a future request for "span-123" triggers a fresh fetch

  Scenario: Stale data triggers background refetch
    Given the trace list was fetched 45 seconds ago (stale)
    When a component subscribes to useTraceList with same params
    Then cached data is served immediately
    And a background refetch fires
    And when fresh data arrives, it replaces the stale data


# ─────────────────────────────────────────────────────────────────────────────
# RACE CONDITIONS
# ─────────────────────────────────────────────────────────────────────────────

Feature: Race condition handling
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

Feature: Security and data isolation
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
