# PR #5012 testing guide — trace analytics foundation (ADR-034 Phases 0-3.5)

Branch: `pr/03-trace-analytics-foundation`. Stacked on PR #4498 — merge it first.

## What shipped

Two new ClickHouse tables — `trace_analytics` (slim
`ReplacingMergeTree(UpdatedAt)`, per-trace) and `trace_analytics_rollup`
(`AggregatingMergeTree` fed per-span with `SimpleAggregateFunction(sum, …)`)
— plus an app-layer module that decides per query whether to read the
rollup, the slim, or fall back to legacy `trace_summaries`. Routing is
silent by default; nothing changes for a customer until
`release_event_sourced_analytics_read` is ON for their project. An
optional tripwire (`release_event_sourced_analytics_read_tripwire`) runs
both queries in parallel and logs divergence beyond a small numeric
tolerance so we canary safely.

## Env vars & feature flags

| Flag | Purpose | Set to enable NEW flow | Set to keep OLD flow |
|---|---|---|---|
| `release_event_sourced_analytics_read` | Route `getTimeseries` reads to `trace_analytics` / `trace_analytics_rollup` when the query shape allows (`pickAnalyticsTable`). | ON in PostHog for canary project(s). Local: `FEATURE_FLAG_FORCE_ENABLE=release_event_sourced_analytics_read`. | Default OFF. All reads go to legacy `trace_summaries`. |
| `release_event_sourced_analytics_read_tripwire` | Run BOTH routed + legacy, compare numerically, log a structured warning on divergence beyond tolerance. Returns the routed result. Requires the read flag ON. | ON in PostHog for canary. Local: same `FEATURE_FLAG_FORCE_ENABLE` mechanism. | Default OFF. No comparison. |

Neither flag has a direct env-var override (they resolve via PostHog +
registry); use `FEATURE_FLAG_FORCE_ENABLE` comma-separated locally:

```bash
FEATURE_FLAG_FORCE_ENABLE=release_event_sourced_analytics_read,release_event_sourced_analytics_read_tripwire pnpm dev
```

## Setup

```bash
make quickstart all-local          # local CH + PG + Redis + app + workers
pnpm dev                            # from langwatch/
```

- **ClickHouse migrations.** This PR ships 00037 (per-span `Cost` +
  `NonBilledCost` on `stored_spans`), 00038 (`trace_analytics_rollup`),
  00039 (`trace_analytics`), applied by the goose runner at worker
  startup. Verify: `clickhouse-client -q "SHOW TABLES LIKE
  'trace_analytics%'"` → expect `trace_analytics` and
  `trace_analytics_rollup`.
- Test-tenant prep: seed ≥~50 traces spanning multiple models, span
  types, and time windows so aggregations are non-degenerate. The
  `scripts/dogfood/` seeders help locally but must not ship in a PR.

## Golden path — happy flow

### 1. Verify write side (silent, always on)

1. Ingest a fresh batch of traces via the SDK.
2. Query — both must be non-zero for the traces just ingested. Slim gets
   one row per (trace, UpdatedAt); rollup one per (span, bucket, model,
   span-type), so rollup cardinality is higher.

   ```sql
   SELECT count() FROM trace_analytics WHERE TenantId = '<projectId>';
   SELECT count() FROM trace_analytics_rollup WHERE TenantId = '<projectId>';
   ```

3. `stored_spans.Cost` + `stored_spans.NonBilledCost` are populated:

   ```sql
   SELECT SpanId, Cost, NonBilledCost FROM stored_spans
   WHERE TenantId = '<projectId>' LIMIT 5;
   ```

### 2. Read side — flag OFF (baseline)

1. No flag set. Open **Analytics → Custom**.
2. Build a `sum(trace.cost) by time` timeseries chart. It renders.
3. App logs show no `[analytics]` route log; every query hit
   `trace_summaries`. Numbers match today's dashboards.

### 3. Read side — flag ON

1. Enable `release_event_sourced_analytics_read` for the project. Reload.
2. Same chart. Numbers **must match** the OFF case within floating-point
   tolerance; a mismatch means the router picked the wrong table.
3. App log shows a route decision — `pickAnalyticsTable` picked
   `trace_analytics_rollup` (additive sum, no exotic filter, group-by
   ∈ `{none, Model, SpanType}`) or `trace_analytics` (percentile,
   late-dim, exotic filter).

### 4. Tripwire ON

1. Also enable `release_event_sourced_analytics_read_tripwire`. Reload.
2. Runs both queries in parallel, returns the routed result, logs
   `analytics.tripwire` at `info` if within tolerance,
   `analytics.tripwire.divergence` at `warn` if not.
3. Grep the logs — a `divergence` finding is a real customer-visible
   regression; triage before enabling the read flag GA-wide.

## Regression traps — what to specifically re-verify

- **Rollup routing shape.** The router must reject any query with
  `series.key !== undefined` — that key-slicing concept isn't modelled in
  the rollup, and a key-bearing query routed there returns empty-string
  EvaluatorType / empty values ("no data"). Re-verify: build a graph
  grouped by a non-modelled dimension (`metadata.someCustomKey`) and
  confirm it falls back to `trace_summaries`, not rollup.
- **`metadata.model` group-by deliberately falls back.** Build a chart
  grouped by `metadata.model`; it must NOT hit `trace_analytics` (real
  slim-vs-rollup semantic divergence, so the router falls back on
  purpose). Log the route decision to confirm.
- **Slim vs `trace_summaries` parity to the cent.** Pick one trace,
  compare `TotalCost` in both tables — byte-identical (bar dedup
  ordering). Covered by
  `src/server/clickhouse/__tests__/trace-analytics.integration.test.ts`
  — run against real CH if you can.
- **Rollup metric family.** `trace_analytics_rollup` uses
  `SimpleAggregateFunction(sum, UInt64)`, NOT `sumState`; the app inserts
  plain numbers and reads plain `sum(…)`. Any `sumMerge(…)` in a query
  builder = regression from the ADR's divergence note. `TraceUniq` /
  `UserUniq` / `ConversationUniq` / `FirstTokenSum` were dropped from the
  rollup; any query touching them routes to slim.
- **`_retention_days` sentinel.** SHOW CREATE TABLE on both tables; the
  `TTL` clause must use `IF(_retention_days > 0, …, '2106-01-01')`. A bare
  `INTERVAL _retention_days DAY` deletes everything on next merge for
  indefinite-retention projects (`_retention_days = 0`). Catch before the
  first insert.
- **Partition-key predicate.** Every routed query includes `OccurredAt`
  (slim) or `BucketStart` (rollup) in `WHERE`. `SET
  send_logs_level='trace'` and confirm partition pruning fires; without
  it a 100 ms query becomes 1-2 s scanning cold S3.
- **Multitenancy.** Every routed query filters `WHERE TenantId =
  {tenantId:String}` first. Enforced by the guard but worth a spot-check.
- **Read routing silent when flag OFF.** With the read flag OFF the app
  must not call the router. Any `pickAnalyticsTable` log line under that
  condition = regression.

## Rollback plan

1. Flip `release_event_sourced_analytics_read` OFF in PostHog. Reads snap
   back to `trace_summaries` on the next request; no restart.
2. Flip `release_event_sourced_analytics_read_tripwire` OFF to stop the
   parallel-query load.
3. Projections keep writing to the new tables silently — no data loss, no
   schema removal. Old cron / dashboards untouched.
4. If a routed query is corrupted, replay: `trace_analytics` fold is
   idempotent (dedup on `UpdatedAt`); `trace_analytics_rollup` must be
   truncated then re-run (per-span increments aren't idempotent under
   crash-retry — accepted, non-systematic).

## Failure modes to alert on

- CloudWatch grep: `analytics.tripwire.divergence` — a real numeric
  mismatch. Triage before continuing rollout.
- Sentry: `Cannot find column EvaluatorId in table trace_analytics` — a
  router bug routed an eval-shaped query onto the trace slim. PR #5014
  owns eval routing; this is a boundary regression.
- Sentry: `Cannot find column FirstTokenSum` on the rollup — the
  dropped-columns list regressed.
- Grafana / CH slow-query dashboard: p99 on `getTimeseries` climbs when
  the flag is ON — usually a routing miss dropping to `trace_summaries`
  under a bad predicate. Log the route decision.
- CloudWatch: `TTL merge dropped N rows for tenant …` where the tenant
  has `_retention_days = 0` — TTL sentinel regressed.
