# PR #5012 testing guide — trace analytics foundation (ADR-034 Phases 0-3.5)

Branch: `pr/03-trace-analytics-foundation`.
Stacked on top of PR #4498 — merge PR #4498 first.

## What shipped

Two new ClickHouse tables — `trace_analytics` (slim
`ReplacingMergeTree(UpdatedAt)`, per-trace) and `trace_analytics_rollup`
(`AggregatingMergeTree` fed per-span with `SimpleAggregateFunction(sum, …)`)
— plus an app-layer analytics module that decides per query whether to
read the rollup, the slim, or fall back to the legacy `trace_summaries`.
Read routing is silent by default; nothing changes for a customer until
`release_event_sourced_analytics_read` is flipped ON for their project.
An optional tripwire (`release_event_sourced_analytics_read_tripwire`)
runs both queries in parallel and logs divergence beyond a small numeric
tolerance so we canary safely.

## Env vars & feature flags

| Flag | Purpose | Set to enable NEW flow | Set to keep OLD flow |
|---|---|---|---|
| `release_event_sourced_analytics_read` | Route `getTimeseries` reads to `trace_analytics` / `trace_analytics_rollup` when the query shape allows (`pickAnalyticsTable`). | ON in PostHog for canary project(s). Local: `FEATURE_FLAG_FORCE_ENABLE=release_event_sourced_analytics_read`. | Default OFF. All reads go to legacy `trace_summaries`. |
| `release_event_sourced_analytics_read_tripwire` | Run BOTH the routed query and the legacy query, compare numerically, log a structured warning on divergence beyond tolerance. Returns the routed result either way. Requires the read flag ON — no effect otherwise. | ON in PostHog for canary project. Local: same `FEATURE_FLAG_FORCE_ENABLE` mechanism. | Default OFF. No comparison. |

Neither flag has an env-var override the app looks at directly (they
resolve via PostHog + registry); use `FEATURE_FLAG_FORCE_ENABLE`
comma-separated for local dev:

```bash
FEATURE_FLAG_FORCE_ENABLE=release_event_sourced_analytics_read,release_event_sourced_analytics_read_tripwire pnpm dev
```

## Setup

```bash
make quickstart all-local          # local CH + PG + Redis + app + workers
pnpm dev                            # from langwatch/
```

- **ClickHouse migrations.** This PR ships migrations 00034 (per-span
  `Cost` + `NonBilledCost` columns on `stored_spans`), 00035
  (`trace_analytics_rollup`), 00037 (`trace_analytics`). They apply via
  the goose runner at worker startup; verify with:

  ```bash
  clickhouse-client -q "SHOW TABLES LIKE 'trace_analytics%'"
  ```

  Expect `trace_analytics` and `trace_analytics_rollup`.
- Test-tenant prep: seed at least ~50 traces spanning multiple models,
  span types, and time windows so aggregations show non-degenerate
  values. The `scripts/dogfood/` seeders can help locally but must
  not ship in a PR.

## Golden path — happy flow

### 1. Verify write side (silent, always on)

1. Ingest a fresh batch of traces via the SDK.
2. Query:

   ```sql
   SELECT count() FROM trace_analytics WHERE TenantId = '<projectId>';
   SELECT count() FROM trace_analytics_rollup WHERE TenantId = '<projectId>';
   ```

   Both must be non-zero for the traces you just ingested. Slim gets
   one row per (trace, UpdatedAt); rollup gets one row per (span,
   bucket, model, span-type) so cardinality is higher.
3. `stored_spans.Cost` + `stored_spans.NonBilledCost` are populated:

   ```sql
   SELECT SpanId, Cost, NonBilledCost FROM stored_spans
   WHERE TenantId = '<projectId>' LIMIT 5;
   ```

### 2. Read side — flag OFF (baseline)

1. Do NOT set any flag. Open **Analytics → Custom** on the project.
2. Build a timeseries chart: `sum(trace.cost) by time`. Chart renders.
3. Watch the app logs — no `[analytics]` route log; every query hit
   `trace_summaries`. Numbers match today's dashboards.

### 3. Read side — flag ON

1. Enable `release_event_sourced_analytics_read` for the project.
2. Reload the custom-analytics page.
3. Same chart. Numbers **must match** the OFF case to within
   floating-point tolerance. If they don't, the router picked the
   wrong table.
4. App log shows a route decision line — `pickAnalyticsTable` picked
   `trace_analytics_rollup` (additive sum, no exotic filter, group-by
   ∈ `{none, Model, SpanType}`) or `trace_analytics` (percentile,
   late-dim, exotic filter).

### 4. Tripwire ON

1. Also enable `release_event_sourced_analytics_read_tripwire`.
2. Reload. Runs both queries in parallel, returns the routed result,
   logs `analytics.tripwire` at `info` if within tolerance,
   `analytics.tripwire.divergence` at `warn` if not.
3. Grep the logs for either — a `divergence` finding is a real
   customer-visible regression and must be triaged before enabling
   the read flag GA-wide.

## Regression traps — what to specifically re-verify

- **Rollup routing shape.** The router must reject any query with a
  `series.key !== undefined` — that "key" concept (custom metric
  key-slicing) is not modelled in the rollup. A key-bearing query
  routed to the rollup returns empty-string EvaluatorType / empty
  values and looks like "no data" to the user. Route table's unit
  tests cover this; re-verify by building a custom-analytics graph
  that groups by a non-modelled dimension (`metadata.someCustomKey`)
  and confirm it falls back to `trace_summaries` (not rollup).
- **`metadata.model` group-by deliberately falls back to
  `trace_summaries`.** Build a chart grouped by `metadata.model`. It
  must NOT hit `trace_analytics` — semantic divergence between slim
  and rollup for that dim is real, and the router falls back on
  purpose. Log the route decision to confirm.
- **Slim vs `trace_summaries` parity to the cent.** Pick one trace,
  compare `TotalCost` in both tables. Must be byte-identical (bar
  ordering of dedup). Parity test in
  `src/server/clickhouse/__tests__/trace-analytics.integration.test.ts`
  covers this — run against real CH if you can.
- **Rollup metric family.** `trace_analytics_rollup` uses
  `SimpleAggregateFunction(sum, UInt64)`, NOT `sumState`. The app
  inserts plain numbers and reads plain `sum(…)`. If you see any
  `sumMerge(…)` in a query builder, that's a regression from the
  shipped divergence note in the ADR. `TraceUniq` / `UserUniq` /
  `ConversationUniq` / `FirstTokenSum` were dropped from the rollup;
  any query touching them routes to slim.
- **`_retention_days` sentinel.** Look at the `TTL` clause on
  `trace_analytics_rollup` and `trace_analytics` (SHOW CREATE TABLE).
  Must use the `IF(_retention_days > 0, …, '2106-01-01')` form. If
  it's a bare `INTERVAL _retention_days DAY`, indefinite-retention
  projects have `_retention_days = 0`, which evaluates to "delete
  everything on next merge." Hard regression — catch it before the
  first insert.
- **Partition-key predicate.** Every routed query must include
  `OccurredAt` (slim) or `BucketStart` (rollup) in `WHERE`.
  `SET send_logs_level='trace'` and confirm partition pruning fires;
  without it a 100 ms query becomes 1-2 s scanning cold S3.
- **Multitenancy.** Every routed query filters
  `WHERE TenantId = {tenantId:String}` first predicate. No exceptions.
  This is enforced by the multitenancy guard but worth a spot-check.
- **Read routing is silent when flag is OFF.** With
  `release_event_sourced_analytics_read` OFF, the app must not even
  call the router. Any `pickAnalyticsTable` log line under that
  condition = regression.

## Rollback plan

1. Flip `release_event_sourced_analytics_read` OFF in PostHog. Reads
   snap back to `trace_summaries` on the next request; no restart.
2. Also flip `release_event_sourced_analytics_read_tripwire` OFF to
   stop the parallel-query load.
3. The projections keep writing to the new tables silently — no data
   loss, no schema removal. The old cron / dashboards are untouched.
4. If a routed query is corrupted, replay to rebuild: `trace_analytics`
   fold is idempotent (dedup on `UpdatedAt`); `trace_analytics_rollup`
   must be truncated then re-run (per-span increments are not
   idempotent under crash-retry — accepted, non-systematic).

## Failure modes to alert on

- CloudWatch grep: `analytics.tripwire.divergence` — any occurrence
  is a real numeric mismatch. Triage before continuing rollout.
- Sentry: `Cannot find column EvaluatorId in table trace_analytics` —
  a router bug routed an eval-shaped query onto the trace slim. PR
  #5014 owns eval routing; this is a boundary regression.
- Sentry: `Cannot find column FirstTokenSum` on the rollup — the
  dropped-columns list regressed; the router sent a query the rollup
  can't serve.
- Grafana / CH slow-query dashboard: p99 on `getTimeseries` climbs
  when flag is flipped ON — usually a routing miss dropping to
  `trace_summaries` under a bad predicate. Log the route decision.
- CloudWatch: `TTL merge dropped N rows for tenant …` where the
  tenant has `_retention_days = 0` — TTL sentinel regressed.
