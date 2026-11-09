# ADR-196: Routed reads are sent read-only, so an abandoned read stops

**Date:** 2026-11-09

**Status:** Proposed

**Builds on:** ADR-114 (the statement budget), ADR-177 (the tenant-scoped reader).

## Context

The app abandons a ClickHouse read in three ways: the vendor client's request
timeout (30 s by default) destroys the socket, a caller's `AbortSignal` does
the same, or the process closes the connection. ClickHouse keeps running the
query unless `cancel_http_readonly_queries_on_client_close` is on and the query
is read-only. `@clickhouse/client` sends every statement as a POST, and a POST
is read-only only when the request sets `readonly` to 1 or 2. Prod's default
profile turns the cancel setting on, so that setting alone changed nothing.
Abandoned reads ran 100 to 800 s and held replica memory and concurrency.

The retry policy makes it worse. It retries a client `Timeout error.` up to
five times, and each attempt starts a new server query while the earlier ones
still run. A test against 25.10 shows three attempts running at once.

ClickHouse 25.10 and 26.8 behave the same here: with `readonly=2` and the
cancel setting, the server stops the query within about 30 ms of the close.
Without them, it runs on.

## Decision

The routing driver sends every read (`execute` and `stream`) with
`readonly=2` and `cancel_http_readonly_queries_on_client_close=1`, over the
read's own settings. Commands and inserts are sent as before.

- A read cannot loosen this: a caller's `readonly=0` is replaced. A caller's
  `readonly=1` is kept, since it is stricter.
- `readonly=2` still allows per-query settings, query parameters, `SHOW`,
  `DESCRIBE`, `EXISTS`, `EXPLAIN`, `system.*` reads and table functions. It
  refuses `INSERT`, `INSERT … SELECT`, `ALTER`, `OPTIMIZE`, DDL and `SYSTEM`
  with READONLY (164).
- A user whose profile already pins `readonly=1` refuses any setting change,
  `readonly=2` included. The driver detects that refusal by its code and
  message, sends the read again with the caller's settings only, and skips
  the two settings for that client from then on. Such a read is read-only
  already, so the user's profile decides whether a close cancels it.
- The retry policy is unchanged. A retried read no longer overlaps the attempt
  it replaces, because the server stopped that attempt when its socket closed.

## Rationale / Trade-offs

The driver is the one place every routed read passes, `TenantScopedReader`
and the id-index reads included, so no repository has to remember the
settings. Setting them per statement, as facet discovery does, leaves every
other read exposed.

An audit of every statement on the read path found only `SELECT`/`WITH`
reads, `system.*` reads and `EXPLAIN`. Every mutation, DDL, `KILL`,
`OPTIMIZE` and `INSERT … SELECT` already goes through `command`. Migrations,
the LWQL executor, the ops `EXPLAIN` endpoint, the admin seam and the upgrade
runner use clients of their own and never reach this driver.

Not retrying client timeouts was the fallback if cancellation could not be
shown. It would turn a slow-but-recoverable read into a failure, and the test
shows cancellation holds, so the retries stay.

## Consequences

- A statement that writes through `query` now fails with READONLY (164)
  instead of writing. It belongs on `command`.
- Cancellation needs the close to reach ClickHouse. A proxy that keeps the
  upstream connection open after the client leaves would defeat it.
- `command` still retries a client timeout without cancelling the earlier
  attempt. A mutation or `INSERT … SELECT` that times out on the client can
  run more than once on the server.

## References

- Spec: `specs/clickhouse/single-client-access.feature`, rule "A read the app
  abandons stops on the server".
- Tests: `packages/clickhouse-client/src/__tests__/read-cancellation.integration.test.ts`,
  `packages/clickhouse-client/src/__tests__/routing-driver-read-cancellation.unit.test.ts`.
