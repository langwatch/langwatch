# ADR-187: Async inserts waiting for a statement slot share one statement

**Date:** 2026-10-29

**Status:** Proposed

**Builds on:** ADR-114 (the statement budget and its lanes), ADR-066 pillar 2
(append coalescing).

## Context

Every ClickHouse statement a process sends holds one slot of its statement
budget until the server answers (ADR-114). The budget is the server's
concurrent-query allowance divided across the clients that share it, so a
process cannot take more slots without risking the server's own limit.

Several writers insert one row at a time with `async_insert=1` and
`wait_for_async_insert=1`: billing meters, per-event projections. The server
buffers such a row and answers only when its buffer flushes, which by design
takes up to the adaptive busy timeout. For that whole time the statement holds
a slot while the server does no work for it. Slots are therefore spent at the
rate rows arrive, multiplied by the flush time. A burst of single-row writes
fills the insert lane, the wait queue fills behind it, and rows are shed as
overload while ClickHouse has CPU, memory and part headroom to spare.

The server merges every row that reaches one buffer into one flush anyway.
Those rows only need to share a table, a format and the settings that form the
buffer's key.

## Decision

We will coalesce, in the query client's insert (`ClickHouseQueryClient.insert`,
the path every process member's write takes), the async inserts that wait for
a slot together:

1. An insert coalesces when it carries rows and no abort signal, and its
   settings turn on `async_insert` and `wait_for_async_insert` and turn
   `async_insert_deduplicate` off explicitly, with no
   `insert_deduplication_token`. Its batch key is its route (tenant,
   organisation, declared tenant set, tenant-check skip), its table and its
   settings in sorted order, so a batch is routed and guarded exactly as each
   member would have been; each member passes the tenant guard on its own
   first. Any other insert goes alone, as before.
2. An insert opens a batch only when the insert lane would make it wait: with
   a slot free, and nothing queued, it goes at once with its own request,
   untouched. Later inserts of the same key join the open batch. When the slot
   is granted the batch closes, and one statement carries every member's rows
   in order, under the same in-place retry rule as any insert (only a refused
   connection is retried).
3. A batch carries at most `insertCoalesceMaxRows` rows (default 5,000). An
   insert that would pass the cap opens a new batch; an insert as large as the
   cap travels alone. Every member brings a row, so the cap bounds the callers
   a batch holds too. Zero turns coalescing off.
4. A batch refused for want of a slot refuses every member with the overload
   error, and counts one shed statement per member, so the shed count still
   counts callers.
5. A batch that fails after admission sends each member's rows again alone
   only when the server rejected the rows unwritten: a parse or conversion
   code (`CANNOT_PARSE_*`, `TYPE_MISMATCH`, `INCORRECT_DATA` and the like).
   A batch under `max_insert_block_size` is one block and one async insert
   entry, so such a refusal wrote none of it, and one caller's bad row must
   not fail the others. Any other failure (a reset, a timeout, a lost answer,
   a server fault) may have written the batch; every member gets that failure
   and nothing is sent again, as an insert alone would have had it.

## Rationale / Trade-offs

A separate pool for async inserts would need slots the budget does not have:
the slots left after reads are fewer than the insert lane holds today. Turning
off `wait_for_async_insert` would free the slot, but the caller would no longer
learn whether its row was written, so a lost row would go unretried.
Raising the budget would risk the server's limit, which is the thing the
budget protects.

Coalescing changes how many statements the rows need, not how many slots a
process may hold. Under load the statements in flight are bounded by the
tables being written times the flush time, not by the row rate. The server
does the same work: it would have merged these rows in its buffer anyway.

Deduplication is why only an insert that turns it off may share. A
deduplicated insert is known by its data or its token; a batch would change
that identity, so two identical inserts that the server would collapse into
one would both land, and a retry would find different neighbours and no
longer match its first attempt. Async deduplication is off by default before
ClickHouse 26.2, but the client cannot see the server's default, so an insert
must say so itself.

Three costs are accepted. A member that joins late inherits the batch's wait
start, so it may be refused sooner than if it had waited alone. A batch whose
rows are rejected is followed by one statement per member, which is what
those callers would have sent without coalescing. A batch that fails in a way
that may have written fails every member, where alone some of them might have
succeeded; resending would risk writing their rows twice.

## Consequences

The event log's appends, which set the async settings themselves and now
turn async deduplication off (the server's default today; the log collapses
repeats by idempotency key), no longer shed under bursts the server can
absorb. Writers that rely on the server profile's async default, and set
nothing, are unchanged until they say so. No infrastructure setting changes. A coalesced statement's result is shared by
its members; the routing driver discards it. Shed counts and lane statistics
keep their meaning: one shed per refused caller, one in-flight per statement.

## References

- `packages/clickhouse-client/src/insert-coalescing.ts`
- `packages/clickhouse-client/src/client.ts` (`ClickHouseQueryClient.insert`)
- `specs/clickhouse/single-client-access.feature`
