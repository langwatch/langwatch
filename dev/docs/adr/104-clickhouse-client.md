# ADR-104: One ClickHouse client, and the schema decides whether a write may be retried

**Date:** 2026-07-29

**Status:** Accepted — the rule is in force; the consolidation onto a single
client is a mechanical migration carried out alongside the package extraction.

**Related:** ADR-099 (`defineTable`, whose declared merge strategy this client
reads to decide retry safety), ADR-098 (the durable-first write ordering that
prohibits fire-and-forget inserts), ADR-100 (the dispatch plane, whose batches
arrive here as inserts).

## Context

There are 7 places that call `createClient`, and no two of them agree.

| site | pool | keep-alive | default settings | retry + metrics |
| --- | --- | --- | --- | --- |
| `clickhouse/client.ts:60` (shared) | 25 | 1500 ms | yes (`:73`) | yes (`:74`) |
| `clickhouse/clickhouseClient.ts:192` (private per-org) | **default 10** | **default 2500 ms** | yes (`:200`) | yes (`:201`) |
| `app-layer/clients/clickhouse.factory.ts:23` | 25 | 1500 ms | **no** (`:34`) | yes (`:34`) |
| `ops/explain-core.ts:244` | 5 | 1500 ms | no (readonly profile) | **no** |
| `clickhouse/goose.ts:64` | default | default | no | **no** |
| `clickhouse/ttlReconciler.ts:357` | default | default | no | **no** |
| `test-utils/clickhouseTestEndpoints.ts:151` | default | default | no | **no** |

Two of those rows are defects rather than differences. A customer on a private
ClickHouse instance gets a 10-connection pool and a 2500 ms idle socket TTL,
because `clickhouseClient.ts:192` omits both options the shared client sets 130
lines away — and 2500 ms sits under the server's own keep-alive by a margin
nobody chose. And `createClickHouseClientFromConfig` returns the resilient
wrapper *without* `wrapWithDefaultSettings` (`clickhouse.factory.ts:34`), so
every read through the composition root in `app-layer/presets.ts:129` runs
without `max_bytes_before_external_group_by` and fails on a large `GROUP BY`
instead of spilling to disk.

**The retry rule is wrong in both directions.** `isTransientError`
(`resilient-client.ts:40`) treats a message matching `/timeout/i` (`:43`) or any
fragment of `CLICKHOUSE_TRANSIENT_MESSAGE_FRAGMENTS` (`:45`) as retryable, and
that list contains `TIMEOUT_EXCEEDED` (`errorHandling.ts:454`) and
`MEMORY_LIMIT_EXCEEDED` (`errorHandling.ts:457`). So the read most expensive to
serve — the one that exhausted the server's per-query memory cap — is issued 4
times with backoff up to 10 s (`resilient-client.ts:309`), holding 4 slots of a
pool that has 10 or 25 of them, and fails identically every time. Meanwhile
`translateClickHouseQueryError` is called only *after* those retries are
exhausted (`:345`), so the typed error the caller finally receives describes a
condition the client already knew about on attempt 1.

**The same loop retries inserts** (`:355`), with no knowledge of what it is
inserting into. A socket timeout on an insert that in fact landed re-sends the
block. Against a `MergeTree` that duplicates rows permanently. Against an
`AggregatingMergeTree` it double-counts, and 4 of the tables are
`AggregatingMergeTree` — `gateway_budget_ledger` (`00017:96`),
`trace_analytics_rollup` (`00038:108`), `evaluation_analytics_rollup`
(`00040:115`) and `gateway_budget_scope_totals_rebuild` (`00058:92`). The insert
path also skips error translation entirely (`:371`), so a write failure reaches
the caller as a raw driver error.

Observability is nominally present and largely inert. `safeQueryMeta` reads
`query_id` off the params (`:152`), but nothing in `src` or `ee` ever sets one
— every log line records `queryId: undefined`, and no query in production can be
correlated to a row in `system.query_log`. `setClickHouseActiveConnections`
(`metrics.ts:149`) has no callers outside its own test, so pool saturation is
unmeasured. `detectColdScan` (`convention-gate.ts:175`) likewise has no callers
outside its test. No query opens a span. There is no per-tenant concurrency
limit anywhere, and no circuit breaker: when the endpoint is down, every caller
independently waits out `request_timeout`, which the driver defaults to 30 s.

## Decision

### 1. One client, one construction path

Every ClickHouse access in the app goes through a single client type with a
single constructor. Pool size, keep-alive, default settings, retry policy,
error translation, metrics and tracing are properties of that constructor, not
of the call site that happened to build a client. Migrations
(`goose.ts`), TTL reconciliation (`ttlReconciler.ts`), the read-only ops
endpoint (`explain-core.ts`) and the test harness construct it with different
*configuration* — a different endpoint, a smaller pool, no default settings
under the `readonly_safe` profile — and never with a different implementation.

### 2. Retry safety is a property of the target table, not of the error

The question "may this write be retried" has a mechanical answer, and
`defineTable`'s `merge` field is the answer.

| target | what a duplicate insert does | automatic retry |
| --- | --- | --- |
| `replacing({ version })` | collapses at merge; reads dedup meanwhile | **yes** |
| `replace` on a Postgres row | upsert by key, idempotent | **yes** |
| `append()` on plain `MergeTree` | duplicates rows, permanently | **no** |
| `append()` on `ReplacingMergeTree` keyed per record | collapses at merge, same as `replacing` | **yes** |
| `aggregating()` | the engine adds — the aggregate is now wrong | **no** |
| DDL, `ALTER`, mutations | not a write to a row | **no** |

`replacing`, and an `append` backed by `ReplacingMergeTree`, are retryable only
because `defineTable` asserts the properties that make them so: a stable sort
key, a stable partition expression, and — for `replacing({ version })` — a
version column that genuinely orders versions. ADR-099 defines `append` two
ways (`099:18-19`): a plain `MergeTree`, where nothing distinguishes a retried
insert from a second row, and a `ReplacingMergeTree` whose sort key already
carries a per-record identity, where a duplicate insert lands on the same key
and collapses at merge exactly as `replacing` does. Which one a given `append`
table is is a property `defineTable` can assert and this client can read — it
is not a judgement made at the call site, and it does not depend on any
server-side dedup setting. A retry that lands in a different partition, or
ties on the version column, does not collapse; ADR-099 refuses to build a
query surface for a table that has not declared these properties, so there is
no path by which an unasserted table reaches this decision.

An `append` on plain `MergeTree`, or an `aggregating()` write, that fails
transiently is surfaced to the caller. The caller is a projection running
under GroupQueue (ADR-100), whose job retry is the correct place for it: the
job re-derives the batch from the event and re-issues the whole write, rather
than re-sending a block whose delivery status is unknown.

**On `insert_deduplication_token`.** Nothing in the repository sets it, or
`replicated_deduplication_window`, or `non_replicated_deduplication_window` —
verified by grep over `langwatch/src` and `langwatch/ee`. The mechanism is
documented upstream: ClickHouse hashes an inserted block and, on the Replicated
engines, records the hash in Keeper so an identical re-insert is ignored;
`insert_deduplication_token` replaces the content hash with a caller-supplied
string. Three things are true and only the first two are verified here.

1. **Whether the replicated path exists at all is a deployment decision this
   repository does not make.** `goose.ts:358` substitutes
   `ReplicatedReplacingMergeTree(` for the engine prefix only when a cluster
   name is configured, otherwise `ReplacingMergeTree(`. So Keeper-backed block
   dedup may or may not be present depending on how the target was migrated.
2. **The 4 `AggregatingMergeTree` tables are not templated at all** — each
   names `AggregatingMergeTree()` literally, so on every deployment they are
   non-replicated, and the Keeper-backed path does not apply to exactly the
   engine where double-counting is worst.
3. **Inferred, not confirmed:** for the non-replicated engines the window is
   governed by `non_replicated_deduplication_window`, which upstream documents
   as disabled by default. Neither that setting nor the deployed servers'
   actual values have been read from a live cluster as part of this decision.

Because of 1 and 2, the retry policy does not depend on server-side dedup, and
must not. A token-based scheme is a legitimate future amendment for a specific
`aggregating` table — it would need a token derived deterministically from the
event's `(occurredAt, eventId)` rather than from block content, a confirmed
dedup window wider than the retry backoff, and confirmed replication for that
table. Until all three are established for a named table, `append` on plain
`MergeTree` and `aggregating` writes are not retried; `append` on a
`ReplacingMergeTree` keyed per record already is, on the structural argument
above, independently of whether server-side dedup is ever adopted.

### 3. A select retries transport failures and nothing else

Retryable: connection reset, socket hangup, `ECONNREFUSED`, `ENOTFOUND`,
`EPIPE`, and HTTP 502/503/504 from a proxy in front of the endpoint. These
describe a request that did not reach a working server.

Not retryable, ever: `MEMORY_LIMIT_EXCEEDED`, `TIMEOUT_EXCEEDED`, and every
query error. Retrying a query that exhausted the server's memory cap exhausts it
again on identical input, and does so while holding a connection the rest of the
process needs. `TIMEOUT_EXCEEDED` is server-side and equally deterministic; a
socket-level timeout is a transport class and is retried, which is why the two
are distinguished by code rather than by matching `/timeout/i` on the message.

`Too many simultaneous queries` stays retryable — it is genuinely a transient
admission-control rejection — but is subject to the bulkhead below rather than
being the only thing standing between a hot tenant and pool exhaustion.

### 4. Tenancy is a routing input, and the bulkhead is per tenant

The client resolves a tenant to an endpoint and holds one pool per endpoint.
The resolution logic in `clickhouseClient.ts:80` and `:108` — env-declared
private URLs by organisation, a `projectId → organizationId` cache, and a
refusal to fall back to the shared endpoint when the project cannot be resolved
(`:91`) — is correct and is preserved verbatim; what changes is that it produces
a routing key rather than a differently-configured client object.

Each pool carries a per-tenant concurrency limit below the pool size. Without
one, a single tenant issuing 10 concurrent unpruned scans occupies the whole
default pool and every other tenant's point read queues behind work that has 30 s
to fail in. The limit is a semaphore, not a queue with unbounded depth: over the
limit the read is rejected fast so the caller's own backpressure applies.

### 5. Reads are buffered unless the caller asks to stream

`ResultSet.stream()` holds a connection open until the stream is consumed, and
`max_open_connections` defaults to 10. A fold reading its own last-committed row
back is a single row by key; streaming it would tie up a tenth of the pool for
the duration of the fold. Buffered reads are the default and the only shape a
projection uses. Streaming is an explicit method, documented for large scans,
exports and backfills, and it is the only place `request_timeout` is raised —
in which case `send_progress_in_http_headers: 1` with
`http_headers_progress_interval_ms` set below the load balancer's idle timeout
is mandatory, because otherwise a long query dies as a socket hangup at the
proxy. The driver itself warns about exactly this above a 60 s `request_timeout`.

Compression is off by default and stays off for the point reads and small
batches that dominate. It is enabled per call for large scans and exports, where
the bytes saved exceed the CPU spent — a judgement made against the payload, not
globally.

### 6. Writes are async-insert-with-wait, never fire-and-forget

Every insert carries `async_insert: 1` and `wait_for_async_insert: 1`.
`wait_for_async_insert: 0` is prohibited: it acknowledges before the data is
durable, which breaks the durable-store-first ordering ADR-098 mandates — a fold
would write its cache entry against a ClickHouse write that has not landed, and
a cold read after a crash serves state that never existed. It also surfaces
insert errors only in the server's own logs, with no backpressure to the writer.

`input_format_skip_unknown_fields: 0` is a client default rather than a
per-repository opt-in. ClickHouse defaults it on, which silently drops a column
the table does not yet have — and the row still lands stamped at the current
projection version, so it passes the read-back version gate and decodes as
all-defaults. Failing the insert instead makes the job retry until the migration
lands.

### 7. Failures are typed only where the caller can act

Three translations survive, and no more:

- `MEMORY_LIMIT_EXCEEDED` → `QueryMemoryExceededError` (422, `errors.ts:68`).
  The caller narrows the range, adds a filter, or selects fewer fields.
- `TIMEOUT_EXCEEDED` → `QueryTimeoutError` (504, `fault: "platform"`,
  `errors.ts:37`). Same remediation; the fault is ours because a query of ours
  was too slow.
- Transport failure → `ClickHouseUnavailableError` (503, `fault: "platform"`,
  `errors.ts:122`).

Everything else passes through untouched (`translate-query-error.ts:71`) and
degrades to "unknown" with a trace id, which is the intended outcome rather than
a gap — `dev/docs/best_practices/error-handling.md` is explicit that a
`HandledError` is a promise the caller can act, and a syntax error in our own
SQL or a `NO_SUCH_COLUMN` after a partial migration gives them nothing to act on.
Every 5xx subclass above sets `fault` explicitly, because it defaults to
`"customer"` and an unannotated 504 would log a real incident as routine noise.

Translation moves to the *first* failure rather than after the retries, and
covers inserts as well as selects. The raw driver error continues to ride in
`reasons`, because the group-queue classifier and the batch splitters unwrap it.

### 8. Every query carries an id, a span and a metric

The client generates a `query_id` per call, derived from the trace id where one
is in scope, so a slow query in the logs can be joined to `system.query_log`
without guessing. It opens a span around the request, and records duration and
outcome on `clickhouse_query_duration_seconds` (`metrics.ts:20`) and
`clickhouse_query_total` (`metrics.ts:37`) labelled by operation and table,
which the resilient wrapper already does and which no other construction site
does at all. Pool saturation finally reaches
`setClickHouseActiveConnections` (`metrics.ts:149`), giving the metric its first
caller and making the bulkhead's effect observable.

### 9. The endpoint breaks the circuit, not every caller's timeout

When an endpoint's failure rate over a rolling window crosses a threshold, the
client fails fast for that endpoint until a probe succeeds. Without it, an
endpoint that is down converts into 30 s of latency multiplied by every
concurrent caller, and the pool fills with requests that are all going to fail.
The breaker is per endpoint, so a private tenant's outage does not open the
shared circuit or the reverse.

## What moves in, and what is dropped

`queryWindowed` (`windowed-read.ts:109`) becomes a method rather than a free
function assigned by reference (`resilient-client.ts:378`). Its behaviour is
unchanged: prune to ±`DEFAULT_PARTITION_WINDOW_MS` (`windowed-read.ts:12`)
around a hint, widen on empty according to the declared fallback, and emit
exactly one outcome on `clickhouse_windowed_read_total` (`metrics.ts:70`)
including on failure. As a method it can read the table's partition column and
stability from `defineTable` instead of taking a column name on trust.

`convention-gate.ts` shrinks to what a builder cannot make unrepresentable.
Under ADR-099 a query built from `defineTable` always carries its tenant
predicate and cannot place a time predicate inside a dedup subquery on a movable
column, so the `tenant_predicate` and `partition_predicate` rules
(`convention-gate.ts:151`, `:158`) have nothing left to catch on those queries.
The gate remains for hand-written SQL — migrations, ops tooling, and the
analytics query builders until they are converted — keeping
`findConventionViolations` (`:136`), its catalogue loop (`:145`) and
`incrementConventionViolation` (`metrics.ts:98`). `CONVENTION_GATE_THROWS`
(`:63`) stays off in production for the reason the module already gives: a
convention violation is a cost problem, and failing a customer's read to save a
request is a bad trade. `detectColdScan` (`:175`) is deleted — it has no callers
outside its own test.

Dropped deliberately: the `/timeout/i` message match; `MEMORY_LIMIT_EXCEEDED`
and `TIMEOUT_EXCEEDED` as retryable classes for reads; blanket insert retry; the
`Object.create` prototype-wrapper and the `Proxy` in
`wrapWithDefaultSettings` (`safeClickhouseClient.ts:17`), whose split
responsibility is what let the factory ship without default settings; and the
per-site `date_time_input_format: "best_effort"` and pool literals.
`READ_BACK_FOLD_INSERT_SETTINGS` (`queryDefaults.ts:58`) stops being a shared
constant repositories must remember to pass and becomes the insert default.

## Rationale / Trade-offs

**Why is retry safety keyed on the table rather than on the error?** Because
the error does not carry the information. A socket timeout is indistinguishable
from the caller's side whether the block landed or not; what differs is the
consequence, and the consequence is entirely a function of the engine. Keying on
the error is how the current loop ended up retrying an `AggregatingMergeTree`
insert 4 times.

**Why not simply make every table `replacing` and retry everything?**
`AggregatingMergeTree` is chosen for the rollups because merging `-State` values
is what makes those queries cheap; converting them to `replacing` moves the
aggregation to read time and gives up the reason they exist. The right answer is
not to retry them.

**Why a per-tenant bulkhead rather than a larger pool?** A larger pool moves the
queue from the client to the server, where `max_concurrent_queries` rejects with
`Too many simultaneous queries` and the transient classifier retries it — which
is the loop the current client already runs, at higher cost. The bulkhead bounds
the damage a single tenant can do to a shared resource, which pool size cannot
express at all.

**Why keep 3 handled errors and not translate more?** Each of the 3 has copy in
`error-remediation.ts` telling the customer something they can do. A 4th for,
say, `UNKNOWN_TABLE` would name our schema in a customer-visible message and
offer no action. `clickhouse_unavailable` is the marginal case — "wait" is
weak remediation — but it earns its place by carrying `fault: "platform"`, which
is what stops a datastore outage being logged and evaluated as customer error.

**Why buffer by default when streaming is strictly more general?** Because the
default is what the hot path gets, and the hot path is a point read under a
fold. Streaming's cost is a held connection, and the pool it is held from is
10 wide by default. Generality that defaults to the expensive shape is a
performance bug with good ergonomics.

## Consequences

- **Retrying a write becomes a lookup rather than a judgement call.** The
  question is answered by the table's declared store kind — and, for
  `append`, by whether `defineTable` asserts a per-record-keyed
  `ReplacingMergeTree` underneath it — at the one place the insert is issued,
  rather than by whoever wrote the repository.
- **`append` on plain `MergeTree`, and `aggregating` writes, now fail where
  they previously silently duplicated or double-counted.** Visible failure
  rates on those tables will rise. That is the defect surfacing, not a
  regression. `append` on a per-record-keyed `ReplacingMergeTree` was already
  safe to retry and continues to be retried.
- **Private-instance tenants get the pool and keep-alive the shared endpoint
  has**, closing a divergence that made a private deployment quietly worse than
  the shared one.
- **Reads through the composition root gain `max_bytes_before_external_group_by`
  for the first time**, so a large `GROUP BY` spills instead of failing.
- **A memory-exhausting read now fails on the first attempt.** Latency on that
  class of failure drops by up to the full backoff, and 3 pool slots per
  failing read are no longer consumed.
- **Queries become correlatable.** A `query_id` and a span exist per call, and
  pool saturation is a metric rather than an inference.
- **This is a large mechanical migration.** 89 call sites resolve a client
  through `getClickHouseClientForProject` / `getClickHouseClientForOrganization`
  and 16 more reach for the shared client directly; all of them move.
- **Behaviour is dropped on purpose**, listed above. The two that will be missed:
  blanket insert retry made some transient write failures invisible, and they
  now become job retries with the latency that implies; and the prototype/Proxy
  wrapping allowed a caller to hold a `ClickHouseClient` from the driver's own
  type, which the new client does not satisfy structurally.
- **Server-side insert dedup remains unadopted and unverified.** If it is ever
  adopted for a specific `aggregating` table, this ADR is amended with the
  confirmed replication topology and window for that table, not generalised.

## References

- `src/server/clickhouse/client.ts`, `clickhouseClient.ts`,
  `safeClickhouseClient.ts`, `queryDefaults.ts` — the shared client, the
  tenant resolver, the settings Proxy and the settings themselves.
- `src/server/app-layer/clients/clickhouse/resilient-client.ts` — the retry,
  logging and metrics wrapper this client absorbs.
- `src/server/app-layer/clients/clickhouse/translate-query-error.ts` and
  `src/server/app-layer/traces/errors.ts` — the 3 surviving translations and
  their handled-error subclasses.
- `src/server/app-layer/clients/clickhouse/windowed-read.ts` — the windowed read
  that becomes a method.
- `src/server/app-layer/clients/clickhouse/convention-gate.ts` — the runtime
  gate, reduced to hand-written SQL.
- `src/server/event-sourcing/services/errorHandling.ts:452` — the transient
  fragment list, which stops governing read retry and continues to govern job
  retry.
- `src/server/clickhouse/goose.ts:358` — where replication is decided, and
  therefore where server-side insert dedup either exists or does not.
- `dev/docs/best_practices/error-handling.md` — handled versus unknown, and why
  most driver errors are the latter.
- `@clickhouse/client` v1.23.0 defaults: `max_open_connections` 10,
  `keep_alive.idle_socket_ttl` 2500 ms, `request_timeout` 30000 ms, compression
  off, and the long-running-query warning above a 60 s `request_timeout`.
