# PR #5014 testing guide — eval analytics write-side aggregates (ADR-034 Phase 6)

Branch: `pr/05-eval-and-write-side-aggregates`. Stacked on PR #5013 — merge it first.

## What shipped

The analytics substrate PR #5012 built for traces, extended to
evaluations.

- **Phase 6 — evaluations.** New `evaluation_analytics_rollup`
  (`AggregatingMergeTree`, migration 00040) and `evaluation_analytics`
  (`ReplacingMergeTree(UpdatedAt)`, migration 00041). Per-eval-terminal-event
  map projection + lean cherry-pick fold. Read routing extended to the
  eval union; two new SQL builders (`eval-slim` + `eval-rollup`) and three
  new read repos. A parallel
  `.withOutbox("evaluationAnalytics", "graphTriggerEvaluation", …)`
  reactor on the eval pipeline uses the **same** handler as PR #5013's
  trace-side reactor. The heartbeat is now source-aware — per-trigger
  metric routes to the correct slim table (trace vs eval) and batches per
  `(project, source)`.
- **Phase 7 — pulled back.** The simulation / experiment / suite
  aggregates (six additional slim + rollup migrations) were pulled back in
  the 2026-07-07 stack review and do NOT ship here. Only the evaluation
  pair (`evaluation_analytics` + `evaluation_analytics_rollup`) shipped.

## Env vars & feature flags

**No new flags introduced.** The PR-5012 read flag now covers eval-source
metrics too — one flip, both sources. The PR-5013 graph-trigger flag now
also gates eval graph triggers.

| Flag | Purpose | Set to enable NEW flow | Set to keep OLD flow |
|---|---|---|---|
| `release_event_sourced_analytics_read` | Extended by this PR: eval-source metrics now route the same way as trace-source (from PR #5012) when the query shape allows. One flag, both sources. | PostHog ON. Local: `FEATURE_FLAG_FORCE_ENABLE=release_event_sourced_analytics_read`. | Default OFF. Eval reads keep going to legacy `evaluation_runs`. |
| `release_event_sourced_analytics_read_tripwire` | Same tripwire from PR #5012, now compares eval-source routed queries to legacy `evaluation_runs` too. Requires the read flag ON. | PostHog ON. | Default OFF. |
| `release_es_graph_triggers_firing` | Extended by this PR: eval-source graph triggers now respect the same per-project flag as trace-source. When ON, cron skips those too. | PostHog ON. Local: `FEATURE_FLAG_FORCE_ENABLE=release_es_graph_triggers_firing`. | Default OFF. Cron handles as today. |

Sims / experiments / suites ship **nothing** here — their slim + rollup
tables were pulled back in the 2026-07-07 stack review.

## Setup

```bash
make quickstart all-local-nlp      # need NLP engine for evaluator runs
pnpm dev                            # from langwatch/
```

- **ClickHouse migrations.** This PR ships 00040-00041. `clickhouse-client
  -q "SHOW TABLES LIKE '%_analytics%'"` → expect `evaluation_analytics`,
  `evaluation_analytics_rollup` plus the trace pair from PR #5012. No
  simulation / experiment / suite tables (Phase 7 pulled back).
- Test-tenant prep: run an evaluator on ≥~20 traces (any built-in judge).

## Golden path — happy flow

### 1. Sanity — trace side untouched

1. With `release_event_sourced_analytics_read` OFF, open the trace
   custom-analytics page.
2. Numbers match PR #5012's baseline — nothing eval-side changed the
   trace query builder.

### 2. Eval graph triggers (flag OFF)

1. Configure an eval-source graph alert on a project without
   `release_es_graph_triggers_firing`.
2. Cron tick fires it through the pre-Liquid legacy path. Baseline
   preserved.

### 3. Eval graph triggers (flag ON)

1. Enable `release_es_graph_triggers_firing`.
2. Fire an evaluator on a trace that breaches the metric threshold.
3. Within seconds (debounced), the eval reactor dispatches via the same
   outbox path the trace reactor uses. Handler is the same
   `evaluateGraphTrigger` from PR #5013.

### 4. Heartbeat source-awareness

1. Project with TWO graph triggers — one metric on the trace slim
   (`trace_analytics`), one on the eval slim (`evaluation_analytics`).
2. Stop ingestion + evaluator runs. Wait ~30s.
3. Heartbeat tick issues at most 2 ClickHouse queries — one per source,
   not one per trigger. Grep for `heartbeat batched project=<X>
   source=trace count=N` and `heartbeat batched project=<X> source=eval
   count=M`.

### 5. Eval slim + rollup are populated

```sql
SELECT count() FROM evaluation_analytics WHERE TenantId = '<projectId>';
SELECT count() FROM evaluation_analytics_rollup WHERE TenantId = '<projectId>';
```

Both non-zero after evaluator terminal events land.

### 6. No sim / exp / suite tables exist

Phase 7 was pulled back. Confirm no `simulation_analytics`,
`experiment_analytics`, or `suite_analytics` tables (or rollups):

```sql
SHOW TABLES LIKE 'simulation_analytics%';
SHOW TABLES LIKE 'experiment_analytics%';
SHOW TABLES LIKE 'suite_analytics%';
```

All three return empty.

### 7. Eval read routing

1. Enable `release_event_sourced_analytics_read`. Reload the eval
   dashboards.
2. `avg(score) by evaluator by time` — router picks rollup (additive over
   modelled eval dims).
3. `p95(score) by evaluator by time` — router picks slim (percentile).
4. `avg(score) by <a-key-bearing-dim>` — falls back to legacy
   `evaluation_runs` because the eval rollup rejects `key !== undefined`
   unconditionally (P0 fix).
5. Numbers match the OFF baseline within tolerance. Tripwire ON confirms
   silently in logs.

## Regression traps — what to specifically re-verify

- **Eval group-by returns real data.** The eval router regressed once and
  emitted rollup queries with an empty-string `EvaluatorType` group-by
  ("empty groups"). Build a `count() group by EvaluatorType` chart and
  confirm it groups by real evaluator types (`class_dummy`,
  `class_semantic`, etc.), NOT a single empty string. Route decision must
  NOT be the rollup path that drops the key.
- **`EvaluatorId` is not a rollup column.** The eval slim WHERE clause
  references `EvaluatorId`; the rollup does NOT. Router must reject
  `key !== undefined` for both, and the eval slim builder must throw loud
  if a key reaches it.
- **TTL sentinel — 2 tables.** Both new tables (00040-00041) use
  `IF(_retention_days > 0, …, '2106-01-01')` (the P0 TTL fix spanning
  00037-00041). Regression = bare `INTERVAL _retention_days DAY` reaps
  indefinite-retention rows on next merge. SHOW CREATE TABLE for each.
- **Reactor name stamp.** The eval notify reactor must emit
  `actionClass: "notify"`. A draft regression dropped that; the
  eval-notify path silently classified as eval-persist and skipped the
  notify branch.
- **Cross-source series mix falls back.** A single chart mixing
  trace-source AND eval-source metrics falls back to `trace_summaries`
  (the router refuses to combine them). Build a chart with `trace.cost`
  and `evaluation.score` side-by-side, log the route decision. Regression
  = router silently returns half the data.
- **Per-source heartbeat batching.** Watch the CH slow-query log on an
  active project with many eval triggers. One query per trigger =
  regression; correct is one per `(project, source)` per tick.
- **Outbox runtime attached (again).** Every stack PR depends on the
  PR-4498 `attachOutbox()` wire-up. Absence: eval reactor's `decide`
  returns enqueues, no `ReactorOutbox` row, no dispatch.
- **No sim/exp/suite artifacts.** Phase 7 pulled back — no
  `simulation_analytics` / `experiment_analytics` / `suite_analytics`
  tables, folds, or projections. Any showing up = the pull-back
  regressed.
- **Case-insensitive `Alert:` prefix.** Same as PR #5013 — applies to
  eval-source graph alerts too.

## Rollback plan

1. Flip `release_event_sourced_analytics_read` OFF. Eval reads snap back
   to `evaluation_runs`; trace reads go with them (same flag, one flip).
2. Flip `release_es_graph_triggers_firing` OFF for affected projects.
   Cron picks them up on the next tick. Same story as PR #5013 for
   trace-source triggers.
3. Projections keep writing silently. Truncate + replay any specific slim
   table if corruption is suspected — folds are idempotent; rollup is
   not, so truncate then replay per the ADR-034 replay discipline.
4. Eval projections can be killed via the per-component
   `es-<aggregate>-<component>-<name>-killswitch` family if needed.

## Failure modes to alert on

- Sentry: `Cannot find column EvaluatorId` on `evaluation_analytics_rollup`
  — router regression, key-bearing query hit the rollup.
- Sentry: `unknown outbox reactor name` at worker boot — eval reactor's
  `definition.name` regressed.
- CloudWatch grep: `heartbeat batched … count=1` at high rate across many
  triggers — batching regressed.
- Grafana: p99 on eval-source `getTimeseries` up 5-10× after the read
  flag ON → routing miss dropping to legacy under an inefficient
  predicate.
- CloudWatch: `TTL merge dropped N rows` on either new table where tenant
  has `_retention_days = 0` → TTL sentinel regressed.
- CloudWatch: `analytics.tripwire.divergence` on eval-source queries —
  real numeric mismatch, triage before wider rollout.
- Sentry: eval reactor stamping wrong `actionClass` — silent routing bug
  (persist branch takes notify's payload).
