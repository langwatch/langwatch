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
mentioned in the response, so a legitimate text search for an older trace is
also a false negative. And the tip that names `get_trace` is appended only on
the success path, so the empty result — the one moment the caller needs a
redirect — is the one place it never prints.

```
  agent holds a trace id
          │
          ├── search_traces(query: "<id>")                    what it reaches for
          │     POST /api/traces/search
          │     WHERE ... AND (  lower(ComputedInput)  LIKE q
          │                   OR lower(ComputedOutput) LIKE q
          │                   OR lower(TraceName)      LIKE q
          │                   OR EXISTS(sp.SpanName    LIKE q) )
          │               AND OccurredAt BETWEEN now-24h AND now
          │                   └─ TraceId is absent from the OR list,
          │                      and the window is ANDed on top of it
          │     -> 0 rows -> "No traces found matching your query."   dead end
          │
          └── get_trace(traceId: "<id>")                      the path that works
                GET /api/traces/{id}
                TraceService.getById(projectId, traceId, protections, opts)
                    └─ no date range in the signature at all
                -> the trace
```

A trace id is not free-form text that might occur in a document; it is a primary
key. The asymmetry above is the whole bug, and it is a guidance failure at the
tool boundary rather than a defect in the query.

Two capabilities already exist and are worth naming, because the decision below
declines to build on either. The engine and the REST boundary already accept
`traceIds: string[]` — `sharedFiltersInputSchema` carries it, it survives into
`getAllForProjectInput` and so into the search body schema, and the engine
applies it as `AND ts.TraceId IN ({traceIds:Array(String)})`. The MCP tool
simply never forwards it; neither, today, does the app's own trace list. And the
error envelope already has a vocabulary for steering a caller: `tips: string[]`,
rendered as a `Tips:` block by `mcp/typescript/src/langwatch-api.ts`.

## Decision

We will state at the tool boundary that a trace id is looked up rather than
searched, and make the empty result carry the reader to the tool that works.

`get_trace` is the sanctioned path for a known id, and its description says so.
It is the right path for a reason the guidance can lean on: `getById` takes no
date range, so an id lookup cannot be missed by a window. The `query` parameter
of `search_traces` says in turn what it does not match — trace ids among them —
so the model has the fact before it makes the call, not only after.

The empty result stops being a dead end. It always names the window it actually
searched and always names `get_trace` for a known trace id, whatever the query
looked like. That unconditional guidance is the load-bearing half of this
decision, because it is the half that cannot misfire.

On top of it, and only on top of it, a narrow shape check adds one sentence when
the query looks like a trace id: the OTel form `[0-9a-f]{32}`, the same with a
`trace_` prefix, and any `trace_`-prefixed token. **The check may only ever add
advice. It must never change what the tool does.** This is the general rule for
the MCP surface, not a detail of this tool: `TraceId` is `String` in ClickHouse
and `trace_id` is `z.string()` in the collector contract, so a customer's ids can
be `order-12345` and no regex over that space can ever be sound. A heuristic that
routed execution would silently turn a legitimate text search into a different
operation on the day it guessed wrong; a heuristic that only ever appends a
sentence is wrong in a way the reader can see and discard.

The window disclosure is what covers the ids the shape check cannot recognise,
which is why it prints unconditionally rather than as the heuristic's else-branch.

## Rationale / Trade-offs

We considered making `search_traces` do what the caller meant and route an
id-shaped query into the id lookup. It is rejected on the soundness argument
above: over a free-form id space the guess is unfalsifiable, and the failure is
silent and semantic rather than visible and recoverable.

We considered adding `TraceId` to the searchable columns so that pasting an id
into free text simply works. It is rejected on blast radius. That predicate is a
hot path shared with the product's own trace list, so the change is a product
decision about the app's search box and not only about the MCP; the `LIKE` shape
the other columns use is not index-friendly on an id column; and it would not
even fix the reported problem, because the window is ANDed on top of the OR and
an older trace would still come back empty. It buys a worse version of the fix
at the highest price.

We considered exposing the `traceIds` passthrough that the REST boundary already
accepts. It is genuinely nearly free and it is the honest answer to "I have five
ids", but it is not the reported problem, and it inherits the window trap: named
ids are still ANDed with the date range, so a batch lookup of older traces
returns nothing unless the default is also widened. Widening it is not free
either — the code's own comment warns that locating traces by id across a wide
window scans every partition including cold S3. It is recorded here as the
obvious follow-up rather than smuggled into a guidance fix.

We considered widening the default window generally. Rejected: it trades a
visible wrong answer for an invisible cost, and disclosure solves the reported
confusion without moving anyone's bill.

The accepted cost is that a caller who ignores prose keeps getting an empty
result. We are choosing to fix a model's tool selection with better words, which
is weaker than making the wrong call impossible, and we accept that in exchange
for not putting an unsound guess on the execution path.

## Consequences

An agent handed a trace id reaches `get_trace` on the first or second attempt
instead of concluding the trace does not exist, and a human reading the
transcript can see which window was searched rather than inferring it. Every
empty search result grows two lines, which is a real cost paid on a path that
previously carried no information at all.

The rule that a heuristic advises but never routes now applies to the whole MCP
tool surface, and the next tool tempted to guess at its caller's intent inherits
it.

Trace-id lookup through `search_traces` stays unavailable, deliberately.
`traceIds` remains wired end-to-end on the server and unexposed on the client,
so the follow-up that exposes it starts from a boundary change and a window
decision, not from new query work.

## References

- Specs: `specs/mcp-server/trace-tools.feature`
- Implementation: `mcp/typescript/src/tools/search-traces.ts`,
  `mcp/typescript/src/create-mcp-server.ts`
- Search predicate: `platform/app/src/server/traces/clickhouse-trace.service.ts`
  (`getAllTracesForProject`), `platform/app/src/server/filters/registry.ts`
- Id lookup: `platform/app/src/server/traces/trace.service.ts` (`getById`)
