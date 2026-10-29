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

We will coalesce, at the statement bound, the async inserts that wait for a
slot together:

1. An insert coalesces when its parameters are only `table`, `values` (an
   array), `format` and `clickhouse_settings`, and its settings turn on both
   `async_insert` and `wait_for_async_insert`. Its batch key is the table, the
   format and its settings in sorted order. An insert with anything else (an
   abort signal, a query id, a stream of values, or no wait for the flush) goes
   alone, as before.
2. The first insert of a key opens a batch and asks the insert lane for a slot.
   Later inserts of the same key join the open batch. When the slot is granted
   the batch closes, and one statement carries every member's rows in order.
   With a slot free the batch holds one insert and adds no wait; that insert is
   sent with its own parameters, untouched.
3. A batch carries at most `insertCoalesceMaxRows` rows (default 5,000). An
   insert that would pass the cap opens a new batch; an insert larger than the
   cap travels alone. Zero turns coalescing off.
4. A batch refused for want of a slot refuses every member with the overload
   error, and counts one shed statement per member, so the shed count still
   counts callers.
5. A batch that fails after admission, with more than one member, sends each
   member's rows again alone, through the same admission. An async insert
   fails as a whole, so one caller's bad row must not fail the others.

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

Two costs are accepted. A member that joins late inherits the batch's wait
start, so it may be refused sooner than if it had waited alone. A failed batch
is followed by one statement per member, which is what those callers would
have sent without coalescing.

## Consequences

Single-row async writers no longer shed under bursts the server can absorb.
No infrastructure setting changes. A coalesced statement's result is shared by
its members; the routing driver discards it. Shed counts and lane statistics
keep their meaning: one shed per refused caller, one in-flight per statement.

## References

- `packages/clickhouse-client/src/insert-coalescing.ts`
- `specs/clickhouse/single-client-access.feature`
