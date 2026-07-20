# ADR-055: Canonical OTLP metric and log pipelines

**Date:** 2026-07-20

**Status:** Proposed

> Behavioural contracts:
> [canonical-metric-ingestion.feature](../../../specs/otlp/canonical-metric-ingestion.feature),
> [canonical-log-ingestion.feature](../../../specs/otlp/canonical-log-ingestion.feature)
>
> Implemented in PR #5945, which supersedes the stacked #5851 (metrics) and
> #5886 (logs).

## Context

LangWatch accepts OTLP over three signals, but only traces had a storage model
built for them. Metrics and logs were flattened into trace-oriented records:
`stored_metric_records` and `stored_log_records` held a lossy projection shaped
by what the trace UI needed, and the remaining OTLP structure was discarded at
ingest.

That loses data we cannot reconstruct. A metric data point carries a typed
value (int or double), a temporality, monotonicity, a start timestamp, exemplars
and, for histograms, bucket layouts that are meaningless once flattened to a
number. A log record carries a typed `AnyValue` body, separate resource, scope
and record attribute sets, severity as both a number and text, and its own
trace/span correlation. The old path kept whichever of these the trace view
happened to read.

Two further problems followed from the same shape. Because metric and log
records were folded into trace aggregates, a metric with no valid exemplar
correlation still had to become part of a trace's state, and the trace folds
carried data no query asked for. And because the write path was the read path,
there was no way to change our mind later: nothing preserved the original
observation, so a new requirement meant reingestion rather than replay.

## Decision

We will store each OTLP signal canonically and independently of traces.

**Canonical rows are immutable and content-addressed.** A metric data point's
`PointId` is `sha256(seriesId ‖ canonical payload)`, where `seriesId` itself
covers the tenant, resource, scope and metric identity. A log record's
`RecordId` is derived the same way. The canonical payload is rendered from the
same view the columns are stored from, so the identity and the persisted row
cannot disagree. Canonical ordering uses ordinal (UTF-16 code unit) comparison
rather than `localeCompare`, so identity never depends on the host locale or ICU
build.

**Every projection in both pipelines is a map projection.** Because each point
and record is its own aggregate of exactly one event, there is no state to
accumulate and therefore nothing to fold.

**Derived data recomputes rather than accumulates.** The 30-second rollup
projection reads before it writes, which is fold-shaped, but it rebuilds the
affected buckets from the authoritative raw rows on every run instead of
carrying state forward. Running it twice produces the same buckets as running it
once.

**Trace correlation is a separate, best-effort concern.** Linking a metric
exemplar or a log record to a span happens through commands on the trace
pipeline, which is where an aggregate with genuine evolving state lives. A
signal is accepted the moment its canonical row is durably enqueued; a failure
to correlate it never becomes an ingest rejection.

**Ingest answers honestly.** OTLP `partialSuccess` reports only records the
server rejected permanently, because a client must not re-send them. Failures on
our side (queue, storage) answer `503`, which is in OTLP's retryable set, and
return a stable message rather than an exception that could name internal hosts,
tables or queries.

**Usage is metered on the record's content, not its stored row.** Both canonical
tables carry an app-supplied `_size_bytes` holding the canonical payload's byte
length, a deliberate exception to the rule set by migration `00032` that
`_size_bytes` is always a `MATERIALIZED byteSize(...)` the application never
writes. The exception is only possible because these columns are declared
`DEFAULT 0`, and therefore insertable, rather than `MATERIALIZED`.

## Rationale / Trade-offs

**Why map projections and not folds.** A fold earns its cost when an aggregate
has a lifetime: state that later events amend. An observation has no lifetime.
Modelling points and records as folds would mean per-series state that lives
forever in a store and refolds from the event log on a cache miss, to derive
something the raw table already answers. The rollup projection is the case worth
naming, because it does read-modify-write and so looks like a fold. Making it
recompute from the raw rows is what keeps it idempotent under replay, and it
means a corrupted rollup is repaired by reprocessing rather than by rebuilding
state.

**Why content-addressed identity.** Deduplication has to survive redelivery,
replay and concurrent shards. A content hash gives every path the same answer
without coordination, and lets both tables use `ReplacingMergeTree` with the
identity in the sort key. The cost is that any change to canonicalisation
changes every identity, which is why the two pipelines deliberately do not share
an `isRecord` helper: the metric one treats arrays as records, and adopting it
in the log canonicaliser would silently re-hash every log body that is an array.

**Why metrics are shadowed from billing and logs are not.** Logs were already
billed, through `stored_log_records`, which canonical logs replace. Shadowing
them would stop billing log storage entirely once the legacy table drains.
Metrics are a data type that was never billed, so they stay out of the
customer-visible meter until they are priced. Metering both on canonical content
bytes rather than physical row size is what keeps the log cutover from acting as
an unannounced price rise, since the canonical row denormalises the same content
into several columns plus a compressed payload.

**Why the legacy log write path stays registered.** The `recordLog` command and
its projection are dead in this build, but a pre-canonical instance can still
send `recordLog` during a rolling deploy. Leaving both wired means those records
land in `stored_log_records` as before, rather than appending an event no
projection consumes and reaching neither table.

**What we accepted.** Canonical storage is larger than the lossy rows it
replaces, and each point is written to both the raw table and the usage ledger.
Rollups pay a read before every write. These are the price of being able to
replay, and the metering decision keeps the storage cost off the customer's bill.

## Consequences

Migrations `00049_create_canonical_metrics` and `00050_create_canonical_logs`
add `metric_data_points`, `metric_series`, `metric_time_rollups`,
`metric_usage_estimates`, `log_records` and `log_usage_estimates`, and narrow
`event_log._size_bytes` so canonical events are not billed alongside their
projections. Both are forward-only. Their numbering is load-bearing: goose only
applies migrations above a database's current version, so a lower number would
be green on a fresh database and silently skipped anywhere already migrated
past it.

Metric and log data is now replayable from the event log, so a future change to
rollups, correlation or the read model no longer requires reingestion.

Two known tensions are documented in the migrations rather than resolved.
`metric_usage_estimates` partitions on `AcceptedAt` while dedupping on a key
that excludes it, so cross-month deduplication happens at query time through
`GROUP BY` with a `HAVING min(AcceptedAt)` bound; this is why its query has no
lower `AcceptedAt` bound, and adding one would re-bill points first accepted
before the window. `metric_series` has the same partition and dedup mismatch and
currently has no reader, so any future reader must dedup explicitly with `FINAL`
or `argMax(…, LastSeenAt)`.

One decision is deliberately deferred. The rollup's predecessor lookups have no
lower time bound, so partition pruning is one-sided. Bounding it is not free: a
predecessor older than twice the rollup interval already starts a new sequence
and contributes nothing to differencing, but dropping it entirely also drops the
gap it represents, because a gap is only counted when a predecessor exists.
Choosing between an unbounded scan and an undercounted `gapCount` needs a
product view of what that counter is for.

The legacy `stored_log_records` and `stored_metric_records` tables are retained,
unmodified, and drain under their existing TTLs. They can be dropped together
with the `recordLog` command and its projection once no pre-canonical instance
can be running.

## References

- Related ADRs: ADR-034 (event-sourced analytics materialization), ADR-046
  (event-sourced Langy conversations)
- Migration `00032` (retention and `_size_bytes` columns), whose
  never-insert-`_size_bytes` rule this ADR carves an exception to
- PRs: #5945 (this work), superseding #5851 and #5886
- Specs: `specs/otlp/canonical-metric-ingestion.feature`,
  `specs/otlp/canonical-log-ingestion.feature`
