# ADR-132: A trace id is looked up, never searched

**Date:** 2026-09-01

**Status:** Proposed

## Context

An agent driving the MCP server is handed a trace id and asked what happened in
that trace. It reaches for `search_traces` and puts the id in `query`, because
that is the tool whose name matches the intent. It gets back
`No traces found matching your query.` and concludes the trace does not exist.
The trace exists. Re-authenticating, the obvious suspect, changes nothing.

Free text never matches a trace id. The search predicate
(`getAllTracesForProject` in `platform/app/src/server/traces/clickhouse-trace.service.ts`)
ORs exactly four things: `ComputedInput`, `ComputedOutput`, `TraceName`, and a
correlated `EXISTS` over `stored_spans.SpanName`. `TraceId` is not among them,
and `platform/app/src/server/filters/registry.ts` carries no `trace_id` filter
field either, so neither the free-text nor the structured half of the tool can
reach an id. The id would surface only by accident, if it happened to appear
inside captured content.

Two further properties turn a wrong answer into a confident one. The default
window is the last 24 hours, applied silently in
`mcp/typescript/src/tools/search-traces.ts` (`now - 86400000`) and never
mentioned in the response — the product's own trace list defaults to 30 days
(`specs/traces-v2/search.feature`), so the two surfaces do not even agree — and
a legitimate text search for an older trace is a false negative for the same
reason. And the tip that names `get_trace` is appended only on the success path,
so the empty result — the one moment the caller needs a redirect — is the one
place it never prints.

```
  agent holds a trace id
          │
          ├── search_traces(query: "<id>")                    what it reaches for
          │     POST /api/traces/search
          │     WHERE ... AND (  lower(ifNull(ComputedInput,''))  LIKE '%q%'
          │                   OR lower(ifNull(ComputedOutput,'')) LIKE '%q%'
          │                   OR lower(ifNull(TraceName,''))      LIKE '%q%'
          │                   OR EXISTS(lower(sp.SpanName)        LIKE '%q%') )
          │               AND OccurredAt BETWEEN now-24h AND now
          │                   └─ TraceId is absent from the OR list,
          │                      and the window is ANDed on top of it
          │     -> 0 rows -> "No traces found matching your query."   dead end
          │
          └── get_trace(traceId: "<id>")                      the path that works
                GET /api/traces/{id}
                TraceService.getById(projectId, traceId, protections, opts)
                    ├─ exact match: getTracesWithSpans(..., occurredAt: undefined)
                    │               unbounded, by design
                    └─ 8..31 hex:   git-style prefix resolution, bounded to
                                    TRACE_ID_PREFIX_LOOKUP_WINDOW_DAYS = 90
                -> the trace
```

A trace id is not free-form text that might occur in a document; it is a primary
key — in `trace_summaries` quite literally, since that table is
`ORDER BY (TenantId, TraceId)`. The asymmetry above is the whole bug, and it is
a guidance failure at the tool boundary rather than a defect in the query.

The storage layer is emphatically not the obstacle. `trace_summaries` carries
`INDEX idx_trace_id TraceId TYPE bloom_filter(0.001)` and
`INDEX idx_tenant_trace (TenantId, TraceId) TYPE bloom_filter(0.001)` on top of
the sort key; `stored_spans` carries bloom filters on `TraceId`, `SpanId`,
`(TenantId, TraceId)` and `(TenantId, TraceId, SpanId)`
(`platform/app/src/server/clickhouse/migrations/00002_create_schema.sql`). An
equality or `IN` match on a trace id is the cheapest shape these tables support.

Two capabilities already exist. The engine and the REST boundary already accept
`traceIds: string[]` — `sharedFiltersInputSchema` carries it, it survives into
`getAllForProjectInput` and so into the search body schema, and the engine
applies it as `AND ts.TraceId IN ({traceIds:Array(String)})`, which lands
directly on the sort key. The MCP tool simply never forwards it; neither, today,
does the app's own trace list. And the error envelope already has a vocabulary
for steering a caller: `tips: string[]`, rendered as a `Tips:` block by
`mcp/typescript/src/langwatch-api.ts`.

The repo has also already ruled, twice, that an empty result must not be able to
stand in for "you asked wrongly": `specs/traces-v2/sessions-lens.feature`
("A failed read is told as a failure, not as an empty result") and
`specs/langy/langy-cli-tool-envelope.feature` ("A rejected command is never read
as an empty result"), the latter written after an agent read a rejected command
as "no results" and reported that as a count. This ADR is the third instance of
that rule, on the MCP surface.

## Decision

We will state at the tool boundary that a trace id is looked up rather than
searched, make the empty result carry the reader to the tool that works, and
expose the exact-match id filter the server already implements.

`get_trace` is the sanctioned path for a single id, and its description says so.
An exact full id resolves unbounded there, so it cannot be missed by a date
window. A truncated hex id of 8 to 31 characters resolves git-style within the
last 90 days (`TRACE_ID_PREFIX_LOOKUP_WINDOW_DAYS`), which is a window, and the
guidance says so rather than promising more than the code does. The `query`
parameter of `search_traces` says in turn what it does not match — trace ids
among them — so the model has the fact before it makes the call.

`search_traces` gains a `traceIds: string[]` passthrough for the batch case,
forwarded to the field the REST boundary already accepts. When `traceIds` is
supplied and the caller named no dates, the window defaults to 90 days rather
than 24 hours, reusing the bound prefix resolution already justifies, and the
response states the window it used. Naming ids is an exact-match intent, and
answering it against yesterday only is a false negative by construction.

The empty result stops being a dead end. It always names the window it actually
searched and always names `get_trace` for a known trace id, whatever the query
looked like. That unconditional guidance is the load-bearing half of this
decision, because it is the half that cannot misfire.

On top of it, and only on top of it, a shape check adds one sentence when the
query looks like a trace id. It reuses the vocabulary the trace service already
exports rather than inventing a second one — `HEX_ONLY`,
`MIN_TRACE_ID_PREFIX_LENGTH` (8) and `FULL_TRACE_ID_LENGTH` (32) from
`platform/app/src/server/traces/trace.service.ts` — so a hex string of 8 or more
characters is recognised, which covers the truncated ids the CLI itself produces
by printing 20 characters in its table. `trace_`-prefixed ids, the form the
collector accepts, are recognised alongside them. **The check may only ever add
advice. It must never change what the tool does.** This is the general rule for
the MCP surface, not a detail of this tool: `TraceId` is `String` in ClickHouse
and `trace_id` is `z.string()` in the collector contract, so a customer's ids can
be `order-12345` and no regex over that space can ever be sound. It is the same
principle ADR-079 settled for card selection — what a deterministic path can
decide is not handed to a non-deterministic oracle — applied to tool routing
rather than presentation.

The window disclosure is what covers the ids the shape check cannot recognise,
which is why it prints unconditionally rather than as the heuristic's else-branch.

## Rationale / Trade-offs

We considered making `search_traces` route an id-shaped query into the id
lookup. It is rejected on the soundness argument above: over a free-form id space
the guess is unfalsifiable, and the failure is silent and semantic rather than
visible and recoverable.

We considered adding `TraceId` to the free-text searchable columns so that
pasting an id into `query` simply works. It is rejected, but not for the reason
it first appears: the column is superbly indexed, so "ids are not indexed" would
be false. The obstacle is the shape of the free-text predicate. The term is built
as `` `%${q}%` `` and applied as `lower(ifNull(col,'')) LIKE {searchQuery}`, and
a bloom filter answers exact membership rather than substring containment, while
the `lower(ifNull(...))` wrapper stops the expression matching any indexed
expression in any case. So an id ORed into that list would scan where an `IN`
would seek — a strictly worse mechanism for a job the sort key already does
perfectly. It is also a hot path shared with the product's own trace list, so
changing it is a product decision about the app's search box rather than an MCP
fix, and it would still be ANDed with the window and so still miss an older
trace.

Exposing `traceIds` instead is the honest version of that idea and is nearly
free, which is why it is in scope rather than deferred: `WHERE TenantId = x AND
TraceId IN (...)` is a primary-key seek.

The cost that does exist is partition pruning, not indexing. `trace_summaries`
is `PARTITION BY toYearWeek(OccurredAt)`, so an id lookup with no date predicate
is a fast seek *within* each partition but must open every weekly partition,
including cold ones on S3 — exactly what the `resolveTraceIdByPrefix` comment
warns about and exactly why prefix resolution bounds itself to 90 days. Defaulting
the id path to that same 90 days, rather than to 24 hours or to unbounded, buys
the recent-trace case that motivates this ADR at a cost the repo has already
accepted once, and the disclosure line means nobody has to guess which it was.

We considered widening the default window for ordinary text search too. Rejected:
it trades a visible wrong answer for an invisible cost across every search, and
disclosure solves the reported confusion without moving anyone's bill.

The accepted cost is that a caller who ignores prose keeps getting an empty
result. We are choosing to fix a model's tool selection with better words, which
is weaker than making the wrong call impossible, and we accept that in exchange
for not putting an unsound guess on the execution path.

## Consequences

An agent handed a trace id reaches `get_trace` on the first or second attempt
instead of concluding the trace does not exist, and a human reading the
transcript can see which window was searched rather than inferring it. An agent
holding several ids can ask for them in one call. Every empty search result grows
two lines, which is a real cost paid on a path that previously carried no
information at all.

`search_traces` now has two windowing defaults — 24 hours for a text search, 90
days when ids are named — which is a wart justified only by the two being
different intents. The response says which one it used, so the wart is visible
rather than silent, and that disclosure is what keeps it honest.

The rule that a heuristic advises but never routes now applies to the whole MCP
tool surface, and the next tool tempted to guess at its caller's intent inherits
it.

Free-text search by trace id stays unavailable, deliberately. The app's own trace
list still does not expose `traceIds`, so the same affordance is a candidate
there; this ADR does not decide it.

## References

- Related ADRs: ADR-079 (card selection is deterministic — the precedent for
  "advice never routes")
- Specs: `specs/mcp-server/trace-tools.feature`,
  `specs/traces/partial-trace-id-resolution.feature` (owns `GET /api/traces/{id}`
  prefix semantics), `specs/traces-v2/search.feature` (the app's 30-day default),
  `specs/traces-v2/sessions-lens.feature` and
  `specs/langy/langy-cli-tool-envelope.feature` (an empty result never stands in
  for a failure)
- Implementation: `mcp/typescript/src/tools/search-traces.ts`,
  `mcp/typescript/src/create-mcp-server.ts`
- Search predicate: `platform/app/src/server/traces/clickhouse-trace.service.ts`
  (`getAllTracesForProject`), `platform/app/src/server/filters/registry.ts`
- Id lookup and shape vocabulary: `platform/app/src/server/traces/trace.service.ts`
  (`getById`, `HEX_ONLY`, `MIN_TRACE_ID_PREFIX_LENGTH`, `FULL_TRACE_ID_LENGTH`,
  `TRACE_ID_PREFIX_LOOKUP_WINDOW_DAYS`)
- Schema: `platform/app/src/server/clickhouse/migrations/00002_create_schema.sql`
