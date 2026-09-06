# ADR-132: A trace id is looked up, never searched

**Date:** 2026-09-01

**Status:** Proposed

## Context

An agent given a trace id is likely to call `search_traces(query: "<id>")`.
That call returns no rows even when the trace exists. Free text searches
captured input, captured output, the trace name and span names. It does not
search `TraceId`, and the MCP tool previously offered no structured trace-id
filter.

The empty response made the mistake hard to diagnose. It did not disclose the
default 24-hour window, and the hint to use `get_trace` appeared only when rows
were found. The product trace list defaults to 30 days, so the MCP and product
surfaces could also disagree without saying why.

The storage layer already supports exact id filtering. The trace search request
schema accepts `traceIds: string[]`, and the ClickHouse query applies
`TraceId IN (...)`. `trace_summaries` is ordered by `(TenantId, TraceId)` and
has trace-id bloom-filter indexes. The missing part is the MCP boundary.

`get_trace` has two relevant behaviours:

- A complete id is tried as an exact lookup without a time window.
- An 8-31 character hex id is treated as a possible prefix and resolved within
  the last 90 days. This bound prevents a miss from scanning every weekly
  ClickHouse partition, including cold storage.

Trace ids remain free-form strings. Values such as `order-12345` are valid, so
no shape check can reliably identify every trace id.

## Decision

`get_trace` is the primary tool for one known trace id. Its tool and parameter
descriptions state the difference between an unbounded exact lookup and a
90-day prefix lookup.

`search_traces` exposes the existing `traceIds` request field for batch lookup.
The MCP input accepts between 1 and 1,000 non-empty ids. When ids are supplied
without dates, the search defaults to the last 90 days. Ordinary text search
keeps its 24-hour default.

Every empty search response states the exact window it searched. It also:

- directs a caller with one known id to `get_trace`;
- directs a caller with several ids to `traceIds`; and
- suggests the next wider window, up to 90 days.

When only `endDate` is supplied, the default-width window is anchored to that
end. An explicit `startDate` after `endDate` is rejected before the API call.

A narrow shape check recognises `trace_` ids and hex strings of at least eight
characters. It may add advice to an empty result. It must never reroute the
request, because custom trace ids make that guess unsound.

## Rationale / Trade-offs

Adding `TraceId` to the free-text predicate was rejected. Free text compiles to
a case-insensitive substring search, while trace ids already have an exact
`IN` path. Mixing the id into the text OR-list would turn a cheap exact filter
into a scan and would still be constrained by the date window.

Automatically routing id-shaped queries to `get_trace` was also rejected.
`TraceId` is a free-form string in storage and the collector contract, so a
regex can only offer a hint. It cannot decide which tool the caller intended.

Batch id lookup remains windowed. An unbounded query would seek within every
weekly partition, including old partitions on S3. Ninety days matches the cost
already accepted for prefix resolution and covers the copied-recent-id use
case. The response and parameter descriptions disclose the bound.

The two default windows are deliberate: 24 hours for content search and 90 days
for named ids. Widening every content search would increase ClickHouse work on
the common path to address an id-specific problem.

## Consequences

An agent holding one id has clear guidance to use `get_trace`. An agent holding
several ids can fetch them through the exact filter in one paginated search.
Empty results no longer hide the searched period.

Free-text search by trace id remains unavailable. The product trace list also
does not expose `traceIds`; that is outside this decision.

The id-shape vocabulary is duplicated between the standalone MCP package and
the platform trace service. Changes to the server's prefix rules must update
the MCP hint as well.

## References

- ADR-079: card selection is deterministic
- `specs/mcp-server/trace-tools.feature`
- `specs/traces/partial-trace-id-resolution.feature`
- `specs/traces-v2/search.feature`
- `mcp/typescript/src/tools/search-traces.ts`
- `mcp/typescript/src/create-mcp-server.ts`
- `platform/app/src/server/traces/trace.service.ts`
- `platform/app/src/server/traces/clickhouse-trace.service.ts`
- `platform/app/src/server/clickhouse/migrations/00002_create_schema.sql`
