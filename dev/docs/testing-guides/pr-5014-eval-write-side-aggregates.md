# PR #5014 testing guide — eval analytics write-side aggregates (ADR-034 Phase 6)

Branch: `pr/05-eval-and-write-side-aggregates`.
Stacked on PR #5013 — merge PR #5013 first.

## What shipped

The analytics substrate PR #5012 built for traces gets extended to
evaluations.

- **Phase 6 — evaluations.** New `evaluation_analytics_rollup`
  (`AggregatingMergeTree`, migration 00040) and `evaluation_analytics`
  (`ReplacingMergeTree(UpdatedAt)`, migration 00041). Per-eval-terminal-event
  map projection + lean cherry-pick fold. Read routing extended to cover
  the eval union; two new SQL builders (`eval-slim` + `eval-rollup`) and
  three new read repos. A parallel
  `.withOutbox("evaluationAnalytics", "graphTriggerEvaluation", …)`
  reactor on the eval pipeline uses the **same** handler as PR #5013's
  trace-side reactor. The heartbeat is now source-aware — per-trigger
  metric routes to the correct slim table (trace vs eval) and batches
  per `(project, source)`.
- **Phase 7 — pulled back.** The simulation / experiment / suite
  aggregates (six additional slim + rollup migrations) were pulled
  back in the 2026-07-07 stack review and do NOT ship in this PR.
  Only the evaluation pair (`evaluation_analytics` +
  `evaluation_analytics_rollup`) shipped.

## Env vars & feature flags

**No new flags introduced.** The same PR-5012 read flag now covers
eval-source metrics too — one flip, both sources routed. The same
PR-5013 graph-trigger flag now also gates eval graph triggers.

| Flag | Purpose | Set to enable NEW flow | Set to keep OLD flow |
|---|---|---|---|
| `release_event_sourced_analytics_read` | Extended by this PR. Trace-source metrics already routed by PR #5012; eval-source metrics now route the same way when the query shape allows. One flag, both sources. | PostHog ON. Local: `FEATURE_FLAG_FORCE_ENABLE=release_event_sourced_analytics_read`. | Default OFF. Eval reads keep going to legacy `evaluation_runs`. |
| `release_event_sourced_analytics_read_tripwire` | Same tripwire from PR #5012, now compares eval-source routed queries to legacy `evaluation_runs` too. Requires the read flag ON. | PostHog ON. | Default OFF. |
| `release_es_graph_triggers_firing` | Extended by this PR. Eval-source graph triggers now respect the same per-project flag as trace-source graph triggers. When ON, cron skips those triggers too. | PostHog ON. Local: `FEATURE_FLAG_FORCE_ENABLE=release_es_graph_triggers_firing`. | Default OFF. Cron handles as today. |

Sims / experiments / suites ship **nothing** in this PR — their
slim + rollup tables were pulled back in the 2026-07-07 stack review.
Only the evaluation aggregate is covered here.

## Setup

```bash
make quickstart all-local-nlp      # need NLP engine for evaluator runs
pnpm dev                            # from langwatch/
```

- **ClickHouse migrations.** This PR ships migrations 00040-00041:

  ```bash
  clickhouse-client -q "SHOW TABLES LIKE '%_analytics%'"
  ```

  Expect: `evaluation_analytics`, `evaluation_analytics_rollup` — plus
  the trace pair from PR #5012. No simulation / experiment / suite
  tables (Phase 7 was pulled back in the 2026-07-07 stack review).
- Test-tenant prep: run an evaluator on at least ~20 traces (any
  built-in judge will do).

## Golden path — happy flow

### 1. Sanity — trace side untouched

1. With `release_event_sourced_analytics_read` OFF, open the trace
   custom-analytics page.
2. Numbers match PR #5012's baseline. Nothing eval-side in this PR
   changed the trace query builder.

### 2. Eval graph triggers (flag OFF)

1. Configure an eval-source graph alert on a project without
   `release_es_graph_triggers_firing`.
2. Cron tick fires it through the pre-Liquid legacy path. Baseline
   preserved.

### 3. Eval graph triggers (flag ON)

1. Enable `release_es_graph_triggers_firing` for the project.
2. Fire an evaluator on a trace that breaches the metric threshold.
3. Within seconds (debounced), the eval reactor dispatches via the
   same outbox path the trace reactor uses. Handler is the same
   `evaluateGraphTrigger` from PR #5013.

### 4. Heartbeat source-awareness

1. Project has TWO graph triggers — one whose metric lives on the
   trace slim (`trace_analytics`), one whose metric lives on the eval
   slim (`evaluation_analytics`).
2. Stop ingestion + evaluator runs. Wait ~30s.
3. Heartbeat tick issues at most 2 ClickHouse queries for this
   project — one per source. Not one per trigger. Grep for
   `heartbeat batched project=<X> source=trace count=N` and
   `heartbeat batched project=<X> source=eval count=M`.

### 5. Eval slim + rollup are populated

```sql
SELECT count() FROM evaluation_analytics WHERE TenantId = '<projectId>';
SELECT count() FROM evaluation_analytics_rollup WHERE TenantId = '<projectId>';
```

Both non-zero after evaluator terminal events land.

### 6. No sim / exp / suite tables exist

Phase 7 was pulled back in the 2026-07-07 stack review. Confirm no
`simulation_analytics`, `experiment_analytics`, or `suite_analytics`
tables (or their rollups) exist:

```sql
SHOW TABLES LIKE 'simulation_analytics%';
SHOW TABLES LIKE 'experiment_analytics%';
SHOW TABLES LIKE 'suite_analytics%';
```

All three return empty.

### 7. Eval read routing

1. Enable `release_event_sourced_analytics_read`. Reload the eval
   dashboards.
2. `avg(score) by evaluator by time` — router picks rollup (additive
   over eval-side dims that ARE modelled).
3. `p95(score) by evaluator by time` — router picks slim (percentile).
4. `avg(score) by <a-key-bearing-dim>` — router falls back to legacy
   `evaluation_runs` because the eval rollup rejects `key !== undefined`
   unconditionally (P0 fix).
5. Numbers match the OFF baseline to within tolerance. Tripwire ON
   confirms silently in logs.

## Regression traps — what to specifically re-verify

- **Eval group-by returns real data.** The eval router regressed
  once and emitted queries against the rollup with an empty-string
  `EvaluatorType` group-by, returning "empty groups". Build a
  `count() group by EvaluatorType` chart and confirm it groups by
  real evaluator types (`class_dummy`, `class_semantic`, etc.), NOT
  a single empty string. Route decision must NOT be the rollup path
  that drops the key — that's the specific bug.
- **`EvaluatorId` is not a rollup column.** The eval slim WHERE
  clause references `EvaluatorId`; the rollup does NOT. Router must
  reject `key !== undefined` for both, and the eval slim builder
  must throw loud if a key reaches it despite that.
- **TTL sentinel — 2 tables.** Both new tables (00040-00041) use the
  `IF(_retention_days > 0, …, '2106-01-01')` form. This was the
  P0 TTL fix spanning migrations 00037-00041. Regression = bare
  `INTERVAL _retention_days DAY` = TTL reaps indefinite-retention rows
  on the next merge. SHOW CREATE TABLE for each.
- **Reactor name stamp.** The eval notify reactor must emit
  `actionClass: "notify"`. Regression in a draft dropped that
  entirely; the eval-notify path silently classified the same as
  eval-persist and skipped the notify branch.
- **Cross-source series mix falls back.** A single chart mixing
  trace-source AND eval-source metrics falls back to
  `trace_summaries` (the router refuses to combine them). Build a
  chart with `trace.cost` and `evaluation.score` side-by-side, log
  the route decision. Regression = router silently returns half of
  the data.
- **Per-source heartbeat batching.** Watch the CH slow-query log
  under an active project with many eval triggers. If you see one
  query per trigger, the source-aware batching regressed. Correct
  behaviour: one query per `(project, source)` per tick.
- **Outbox runtime attached (again).** Every stack PR now depends on
  the PR-4498 `attachOutbox()` wire-up. Absence signature: eval
  reactor's `decide` returns enqueues, no `ReactorOutbox` row lands,
  no dispatch.
- **No sim/exp/suite artifacts.** Phase 7 was pulled back — no
  `simulation_analytics` / `experiment_analytics` / `suite_analytics`
  tables, folds, or projections should exist. If any of those
  migrations or registrations show up, the pull-back regressed.
- **Case-insensitive `Alert:` prefix.** Same as PR #5013 — regression
  applies to eval-source graph alerts too.

## Rollback plan

1. Flip `release_event_sourced_analytics_read` OFF. Eval reads snap
   back to `evaluation_runs`; trace reads go with them (same flag,
   one flip).
2. Flip `release_es_graph_triggers_firing` OFF for affected projects.
   Cron picks them up on the next tick. Same rollback story as
   PR #5013 for trace-source triggers.
3. Projections keep writing silently. Truncate + replay any specific
   slim table if data corruption is suspected — folds are idempotent.
   Rollup is not; truncate then replay per the ADR-034 replay
   discipline.
4. Eval projections can be killed via the per-component
   `es-<aggregate>-<component>-<name>-killswitch` family if needed.

## Failure modes to alert on

- Sentry: `Cannot find column EvaluatorId` on `evaluation_analytics_rollup`
  — router regression, key-bearing query hit the rollup.
- Sentry: `unknown outbox reactor name` at worker boot — eval reactor's
  `definition.name` regressed.
- CloudWatch grep: `heartbeat batched … count=1` at high rate across
  many triggers — batching regressed.
- Grafana: p99 on eval-source `getTimeseries` up 5-10× after
  `release_event_sourced_analytics_read` ON → routing miss dropping
  to legacy under an inefficient predicate.
- CloudWatch: `TTL merge dropped N rows` on either of the 2 new tables
  where tenant has `_retention_days = 0` → TTL sentinel regressed.
- CloudWatch: `analytics.tripwire.divergence` on eval-source queries
  — real numeric mismatch, triage before wider rollout.
- Sentry: eval reactor stamping wrong `actionClass` — silent
  routing bug (persist branch takes notify's payload).
