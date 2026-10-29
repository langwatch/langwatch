# ADR-189: One table for all eval results, recalled before judging

**Date:** 2026-10-28

**Status:** Accepted (Drew, 2026-10-29)

> One line: every eval result is a row in one ClickHouse table, `eval_results`, linked to its trace and tagged with its source (ask, run, dashboard, monitor). Before judging, we look up the same trace, question and judge model, and reuse the row if it exists. The table is append-only and follows the trace's retention. Monitors move in as phase 2.

## Context

- Issue: https://github.com/langwatch/tasks/issues/986
- On 2026-10-27 a Slack thread found no agreed model for where instant eval results live. Langy gave different answers to the same question.
- The first draft of this record recommended a split by use, with a monitor as the store for dashboards. Drew rejected it in review (Laze, 2026-10-28). A monitor decides when judging happens. It is not a place to keep results. He asked for one table, like competitors.
- This record builds on ADR-153 (a run is a judgment job), ADR-174 (the judge call is metered) and ADR-182 (the decision model is a Default models column).

### Today

| Trigger                                  | Stored?                       | Where                                                                    | On the trace page? |
| ---------------------------------------- | ----------------------------- | ------------------------------------------------------------------------ | ------------------ |
| Quick `eval()` in an LWQL query          | No, in memory for the call    | `instant-eval-judge-rows.service.ts:94` (a `Map`)                        | No                 |
| Instant Eval run (search bar, CLI, REST) | Yes, indefinitely             | `instant_eval_runs` and `instant_eval_judgments` (migrations 00098, 00097) | No                 |
| Code widget with `eval()`                | No, judges on every run       | Same path as a quick `eval()` (`use-dashboard-widget-executor.ts:91`)    | No                 |
| Saved-chart widget with `eval()`         | Cannot hold `eval()` today    | Save refuses it (`saved-workbench-chart-policy.service.ts:36-41`)        | No                 |
| Monitor (online eval)                    | Yes, with the trace retention | `evaluation_runs` (00002), fed by `lw.evaluation.*` events               | Yes                |

Facts the design rests on:

- `instant_eval_judgments` is `ReplacingMergeTree(UpdatedAt)`, `PARTITION BY toYYYYMM(CreatedAt)`, `ORDER BY (TenantId, RunId, TraceId, SpanId, QuestionId)` (00097). `QuestionId` is the statement's column alias, not the question. A read by trace is not a prefix of the key.
- A run writes one bulk insert per page of up to 500 rows (`INSTANT_EVAL_PAGE_SIZE`, `instant-eval-run-sizing.rules.ts:15`) through `instant-eval-judge-page.service.ts:450`, with `async_insert` (`clickhouse.instant-eval-judgments.repository.ts:87-113`). The record carries no `_retention_days`, so every row keeps the default 0, which means never expire.
- `instant_eval_judgments` and `instant_eval_runs` are in `INDEFINITE_DEFAULT_RETENTION_TABLES` (`modules/data-retention/contract/src/retention-tables.ts:81-87`), not in the customer cascade.
- `Passed` is derived at write from `Probability >= threshold` (`instant-eval-verdicts.rules.ts:49-54`). So a pass can be derived again on read with any threshold.
- Two readers depend on the judgments table: the Explorer `eval:"question"` chip (`trace-query-subquery.rules.ts:74`, a declared exception in `clickhouse-table-ownership.ts:128-133`) and the LWQL `analytics.judgments` view (`lwql-view-catalog.rules.ts:2277-2279`).
- `evaluation_runs` is `ReplacingMergeTree(UpdatedAt)`, `PARTITION BY toYearWeek(ScheduledAt)`, `ORDER BY (TenantId, EvaluationId)` (00002). The trace page reads it through `trace-evaluation-runs.repository.ts`, helped by the `evaluation_runs_by_trace_id_index` (00121).

## The two questions

The first draft mixed two questions. They are separate.

1. **When does judging happen?** This is the trigger. There are four: a quick `eval()` ask, a run over past traces, a monitor on each new trace, and a dashboard widget.
2. **Where does the result live?** This is storage. The answer is the same for every trigger: one row per result, linked to its trace by id.

Instant evals need no special storage. Three things differ from a monitor, and the design covers each:

- **Bursts.** A run or a widget can judge thousands of traces at once. We write in bulk, one insert per page or per query, as runs do today.
- **A free-text question, not an evaluator id.** We store the question text and a hash of it. The hash is the key.
- **Repeats.** People and dashboards ask the same question of the same trace many times. We recall before judging.

## Decision

### 1. One table, `eval_results`

Every result is a row. It names its trace, the question, the judge model, the source and the verdict. The proposed schema, in the shape of 00097 and the repo's TTL conventions:

```sql
CREATE TABLE IF NOT EXISTS ${CLICKHOUSE_DATABASE}.eval_results
(
    TenantId String CODEC(ZSTD(1)),

    -- What was judged. SpanId and ThreadId are empty when the statement did not project them, as in 00097.
    TraceId String CODEC(ZSTD(1)),
    SpanId String DEFAULT '' CODEC(ZSTD(1)),
    ThreadId String DEFAULT '' CODEC(ZSTD(1)),

    -- What was asked. QuestionHash is sha256 of the normalised text, kind and category options.
    QuestionHash String CODEC(ZSTD(1)),
    Question String CODEC(ZSTD(3)),
    Kind LowCardinality(String) CODEC(ZSTD(1)),
    JudgeModel LowCardinality(String) CODEC(ZSTD(1)),
    InputHash String DEFAULT '' CODEC(ZSTD(1)),

    -- Who asked: ask, run, dashboard or monitor, and the id of that query, run, widget or monitor.
    Source LowCardinality(String) CODEC(ZSTD(1)),
    SourceId String CODEC(ZSTD(1)),

    -- The verdict, as in 00097. No Passed column: a pass is Probability against the reader's threshold.
    Status LowCardinality(String) CODEC(ZSTD(1)),
    Score Nullable(Float64) CODEC(ZSTD(1)),
    Label String DEFAULT '' CODEC(ZSTD(1)),
    Probability Nullable(Float64) CODEC(ZSTD(1)),
    Probabilities String DEFAULT '' CODEC(ZSTD(1)),
    Error String DEFAULT '' CODEC(ZSTD(1)),

    OccurredAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),  -- the trace's time; partition and TTL anchor
    JudgedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),    -- when the judge answered; "latest" means this
    UpdatedAt DateTime64(3) CODEC(Delta(8), ZSTD(1)),   -- write clock; version for redelivered pages

    `_retention_days` UInt16 DEFAULT 0 CODEC(Delta(2), ZSTD(1)),

    INDEX idx_source_id SourceId TYPE bloom_filter(0.001) GRANULARITY 1,
    INDEX idx_question_hash QuestionHash TYPE bloom_filter(0.01) GRANULARITY 4
)
ENGINE = ${CLICKHOUSE_ENGINE_REPLACING_PREFIX:-ReplacingMergeTree(}UpdatedAt)
PARTITION BY toYearWeek(OccurredAt)
ORDER BY (TenantId, TraceId, SpanId, QuestionHash, JudgeModel, SourceId)
TTL IF(_retention_days > 0, toDateTime(OccurredAt) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
```

Why this shape:

- **The sort key leads with the trace.** `(TenantId, TraceId, SpanId, QuestionHash, JudgeModel)` is the recall key and the trace page's read. Both are prefix reads.
- **`SourceId` ends the key.** A redelivered page re-inserts the same `SourceId`, so the replacing merge collapses it, as 00097 does for `RunId` today. A new ask, run or "judge again" has a new `SourceId`, so it adds a row. That is how the table stays append-only and safe to redeliver at once.
- **The partition and TTL anchor on `OccurredAt`**, the trace's time. `trace_summaries` uses the same anchor (`ttl.reconciler.ts:139-145`) and the same `toYearWeek` partition (00002 line 179). So a result expires with its trace.
- **The TTL clause** is what `buildRetentionTTLExpression` emits for a `TABLE_TTL_CONFIG` entry with `retentionTTLColumn: "OccurredAt"` (`ttl.reconciler.ts:327-331`). The reconciler then finds it correct and issues no ALTER.
- **The bloom filter on `SourceId`** serves a run's results page, which reads by run, not by trace. The pattern is the `idx_trace_id` bloom filter on `evaluation_runs` (00002).
- **No judged text is stored**, as in 00097. `InputHash` is a hash of the judged text, not the text.
- **A judgment of free text with no trace is not stored.** It has no trace to link to.

The migration is one new goose file with the next free number, created with `IF NOT EXISTS`. It is a new table, not an ALTER of `instant_eval_judgments`, because that table's sort key cannot change in place.

### 2. Append-only, recall first

Before judging, the service looks up the rows that match trace, span, question hash, judge model and input hash. It reuses a match. It judges only the misses, then writes them in one bulk insert.

- **A recall makes no judge call**, so it is free, and every viewer sees the same number.
- **The table is the cache.** There is no separate cache with its own expiry.
- **A new row is added only when something changed:** a new judge model, an explicit "judge again", or changed judged text (`InputHash`). Both rows are kept with their times, because a judge is not deterministic.
- **Readers take the latest row** per trace, span and question by `JudgedAt` (`argMax`), as `clickhouse.instant-eval-judgments.repository.ts:28-45` does today with `UpdatedAt`. A reader that wants history reads every row.
- **The threshold is not in the hash.** A pass is `Probability >= threshold`, applied on read (`instant-eval-verdicts.rules.ts:49-54`). Two viewers with different thresholds share the same judge call.

Each trigger uses the same path:

| Trigger            | `Source`    | `SourceId`      | What recall gives                                         |
| ------------------ | ----------- | --------------- | --------------------------------------------------------- |
| Quick `eval()` ask | `ask`       | the query id    | A repeat question is free and stays the same answer.      |
| Run                | `run`       | the run id      | A rerun pays only for traces it has not judged.           |
| Dashboard widget   | `dashboard` | the widget id   | A refresh pays only for new traces. All viewers agree.    |
| Monitor (phase 2)  | `monitor`   | the monitor id  | Results land beside the others and show on the same page. |

### 3. The trace page reads this table

The trace drawer shows every result on its trace, labelled by source. `eval_results` is owned by the instant-eval module. A plain read of another module's table is a query on its owner's `*Api` (`dev/docs/ARCHITECTURE.md` section 7, "A ClickHouse table has one owner"). So instant-eval adds a results-by-trace query to `InstantEvalApi`. Trace calls it through a channel bound to that token (section 5, "A channel may be bound to another module's `*Api` token"). A binding makes no peer edge, so it is allowed although instant-eval already depends on `TraceApi` (`instant-eval.app.ts:152-157`, `static dependencies`).

The Explorer chip subquery and the `analytics.judgments` LWQL view move to `eval_results`. The ownership exception in `clickhouse-table-ownership.ts` moves with them.

### 4. Retention follows the trace

Three changes make a result expire with its trace. Each follows a pattern already in the repo.

1. **Stamp at write.** Each row gets the project's trace retention in `_retention_days`, from `DataRetentionApi.getRetentionDays({ projectId, category: "traces" })` (`data-retention.api.ts:36`). `evaluation_runs` does the same with `context.retentionPolicy?.traces` (`evaluation-run.store.ts:36`).
2. **Enrol the table in the cascade.** Add `eval_results: "traces"` to `RETENTION_TABLE_CATEGORY_MAP` (`retention-tables.ts:8-28`). When a project's retention changes, the retroactive repository rewrites `_retention_days` for every table in that map (`clickhouse.retroactive-retention.repository.ts:113-160`).
3. **Add a `TABLE_TTL_CONFIG` entry** with `ttlColumn` and `retentionTTLColumn` set to `OccurredAt` (`ttl.reconciler.ts:28`), for cold storage and the TTL check.

Enrolment also adds the table to the storage meter (`PRODUCTION_STORAGE_METER_TABLES`, `retention-tables.ts:114-116`), which sums `_size_bytes`. We list `eval_results` in `TABLES_WITHOUT_SIZE_COLUMN` (`retention-tables.ts:107-112`), as the analytics tables are. A result holds no customer text, so the meter would count only small verdict rows.

### 5. Monitors: phase 2 (decided: later)

Monitors write `evaluation_runs` today. Moving them into `eval_results` is the real goal: one table, one trace-page read, one filter word. It is phase 2, after instant evals land.

- **The work.** A monitor's completed event also writes a row with `Source = monitor` (a dual write, additive). Then each reader moves: the trace drawer, the `evaluations.passed` filter, the built-in eval charts (`evaluation_analytics`, `evaluation_analytics_rollup`, migrations 00041 and 00040) and the triggers. Last, monitors stop writing results to `evaluation_runs`. For a monitor with a classic evaluator, `QuestionHash` hashes the evaluator type and its settings.
- **Ownership.** One module owns a table (ARCHITECTURE section 7). Phase 2 decides whether `eval_results` stays with instant-eval, which the evaluation module then writes through `InstantEvalApi`, or moves to the evaluation module.
- **Until then** the trace page reads two stores, `eval_results` and `evaluation_runs`, and labels the source.

| When        | For                                                                          | Against                                                                                         |
| ----------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Now         | One store from day one. No second read on the trace page.                   | Instant evals wait on a migration of charts, filters, triggers and the monitor lifecycle.       |
| Later (rec) | Instant evals ship first. The phase 2 dual write is additive and reversible. | Two stores for a while. Two filter words (`evaluations.passed`, `eval:"q"`) until readers move. |

Decided: later (Drew, 2026-10-29).

## Alternatives considered

### Split by use (the first draft's Option D)

A quick `eval()` stays unsaved, a run keeps its own table, and a dashboard that must stay current is a monitor on the instant evals judge.

Rejected. It treats a trigger (the monitor) as a store. It gives Langy three answers to teach. A quick ask never shows on its trace, and every dashboard refresh pays again. A monitor cannot go back over old traces.

### Cache only

Keep verdicts for a short time, keyed by model, question and text hash. No row lasts past the window.

Rejected. The trace page and dashboards get no lasting result. When the cache expires, viewers see a new number. An append-only table with recall gives the same saving with no expiry and no second source of truth.

### One `lw.evaluation.reported` event per result, folded into `evaluation_runs`

Reuse the collector write-back path (`trace-collector-dispatch.service.ts:219`, `reportOneEvaluation`).

Rejected for instant evals. A run of 100,000 rows and 10 questions is 1,000,000 events, each with fold and analytics rows, written one by one. The same run in `eval_results` is 200 bulk inserts of 5,000 rows. `evaluation_runs` is keyed by `EvaluationId`, so a recall by trace and question is not a prefix read. Its lifecycle columns (scheduled, started, attempts) do not apply to an instant verdict. Phase 2 goes the other way: monitors move into the one table.

## How others do it

From public documentation read on 2026-10-28. All four keep results beside the trace, linked by id, and none rewrites the judged data. None documents a cache-only mode.

| Product   | Model                                                                         | Source                                                                                                  |
| --------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Langfuse  | A score is its own object linked to a trace or observation, with a source.   | https://langfuse.com/docs/evaluation/scores/data-model                                                  |
| Braintrust | Scores sit on the span, or in a scoring span added to the trace.             | https://www.braintrust.dev/docs/observe/score-online                                                    |
| Phoenix   | Evaluations are span annotations keyed by `span_id`.                        | https://arize.com/docs/phoenix/tracing/how-to-tracing/feedback-and-annotations/llm-evaluations          |
| Datadog   | Evaluations join on span and trace id and show on the span.                  | https://docs.datadoghq.com/llm_observability/evaluations/submit_evaluations/                            |

## Decisions on the open questions

Drew accepted both on 2026-10-29 (Convoz ask 12563).

1. **Monitors into the one table: now or later?** Later (section 5).
2. **Does changed judged text count as "something changed"?** Yes. The text is read anyway to judge, and a trace can gain spans after its first judgment. Without it, a recall can return a verdict on text that is no longer there.

## Risks

- **Concurrent misses.** Two viewers who open a new widget at the same moment can both miss and both judge. Both rows are kept and readers take the latest. A single-flight lock per key is a later fix if the cost shows.
- **The hosted judge changes under one id.** Recall keys on `JudgeModel`. If `langwatch/instant-evals` (`instant-eval-judge.api.ts:103`) changes its weights without a new id, recall serves old verdicts. A new judge version must change the id the row records.
- **Dashboard reads are not prefix reads.** A widget reads by question over a time window, and the key leads with the trace. Partitions prune by `OccurredAt` and the `QuestionHash` bloom filter skips granules. This is unmeasured. If it is slow, add a time-leading rollup as ADR-034 did for evaluations.
- **The key cap.** A quick `eval()` refuses above 1,000 trace keys (`langwatch-ql-app-function-shapes.rules.ts:96-103`). Whether a recalled key counts toward the cap goes to the build PLAN.
- **Old judgments.** `instant_eval_judgments` keeps its rows with no expiry. A background step (`.withMigrations`) copies them into `eval_results` with `Source = run`. The old table is then dropped as an operator step, never in a goose file.

## Consequences

- Langy gives one answer: "Every eval result is saved on its trace. Asking the same question again is free unless the judge changed."
- The trace drawer shows instant eval results beside monitor results, labelled by source.
- A dashboard widget with `eval()` pays only for new traces, and every viewer sees the same number.
- A quick `eval()` now writes rows. It costs one recall read and one bulk insert per query.
- Instant eval results follow the trace's retention, not "never expire".
- Monitors keep writing `evaluation_runs` until phase 2.

## References

- ADR-034: event-sourced analytics materialisation: `dev/docs/adr/034-event-sourced-analytics-materialization.md`
- ADR-153: an Instant Eval run is a judgment job: `dev/docs/adr/153-instant-eval-run-is-a-judgment-job.md`
- ADR-174: the judge call is metered: `dev/docs/adr/174-instant-evals-judge-call-is-metered.md`
- ADR-182: the decision model is a Default models column: `dev/docs/adr/182-instant-evals-decision-model-is-a-default-model-column.md`
- Review of the first draft: https://github.com/langwatch/langwatch/pull/9129
- Issue: https://github.com/langwatch/tasks/issues/986
