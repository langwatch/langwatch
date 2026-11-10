# ADR-189: One table for every Instant Evals judgment, recalled before judging

**Date:** 2026-10-28

**Status:** Accepted (Drew, 2026-10-29)

> One line: every trace-linked Instant Evals result is a row in one ClickHouse table, `eval_results`, linked to its trace and tagged with its source (ask, run, dashboard, monitor). Before judging, we look up the same trace, question, judge model and judged text (its hash), and reuse the row if it exists. The table is append-only and follows the trace's retention. Every trace-linked Instant Evals judgment lands here, whoever asked; a monitor still keeps its own `evaluation_runs`.

## Context

- Issue: https://github.com/langwatch/tasks/issues/986
- On 2026-10-27 a Slack thread found no agreed model for where instant eval results live. Langy gave different answers to the same question.
- The first draft of this record recommended a split by use, with a monitor as the store for dashboards. Drew rejected it in review (Laze, 2026-10-28). A monitor decides when judging happens. It is not a place to keep results. He asked for one table, like competitors.
- This record builds on ADR-153 (a run is a judgment job), ADR-174 (the judge call is metered) and ADR-182 (the decision model is a Default models column).

### Today

| Trigger                                  | Stored?                       | Where                                                                    | On the trace page? |
| ---------------------------------------- | ----------------------------- | ------------------------------------------------------------------------ | ------------------ |
| Quick `eval()` in an LWQL query          | No, in memory for the call    | `instant-eval-judge-rows.service.ts:102` (a `Map`)                        | No                 |
| Instant Eval run (search bar, CLI, REST) | Yes, indefinitely             | `instant_eval_runs` and `instant_eval_judgments` (migrations 00098, 00097) | No                 |
| Code widget with `eval()`                | No, judges on every run       | Same path as a quick `eval()` (`use-dashboard-widget-executor.ts:118-120`)    | No                 |
| Saved-chart widget with `eval()`         | Cannot hold `eval()` today    | Save refuses it (`saved-workbench-chart-policy.service.ts:36-41`)        | No                 |
| Monitor (online eval)                    | Yes, with the trace retention | `evaluation_runs` (00002), fed by `lw.evaluation.*` events               | Yes                |

Facts the design rests on:

- `instant_eval_judgments` is `ReplacingMergeTree(UpdatedAt)`, `PARTITION BY toYYYYMM(CreatedAt)`, `ORDER BY (TenantId, RunId, TraceId, SpanId, QuestionId)` (00097). `QuestionId` is the statement's column alias, not the question. A read by trace is not a prefix of the key.
- A run writes one bulk insert per page of up to 500 rows (`INSTANT_EVAL_PAGE_SIZE`, `instant-eval-run-sizing.rules.ts:15`) through `instant-eval-judge-page.service.ts:452`, with `async_insert` (`clickhouse.instant-eval-judgments.repository.ts:87-113`). The record carries no `_retention_days`, so every row keeps the default 0, which means never expire.
- `instant_eval_judgments` and `instant_eval_runs` are in `INDEFINITE_DEFAULT_RETENTION_TABLES` (`modules/data-retention/contract/src/retention-tables.ts:81-87`), not in the customer cascade.
- `Passed` is derived at write from `Probability >= threshold` (`instant-eval-verdicts.rules.ts:49-54`). So a pass can be derived again on read with any threshold.
- Two readers depend on the judgments table: the Explorer `eval:"question"` chip (`trace-query-subquery.rules.ts:74`, a declared exception in `clickhouse-table-ownership.ts:128-133`) and the LWQL `analytics.judgments` view (`lwql-view-catalog.rules.ts:2295-2296`).
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

    -- What was judged. SpanId is empty when the statement did not project it, as in 00097.
    TraceId String CODEC(ZSTD(1)),
    SpanId String DEFAULT '' CODEC(ZSTD(1)),

    -- What was asked. QuestionHash: sha256 of the normalised kind, text, criteria, range and categories (not the column alias).
    -- JudgeModel: the resolved decision model (ADR-182): the own model id, or the hosted classifier id and version.
    -- InputHash: sha256 of the judged column name and its text; for a monitor, of {input, output, contexts} as canonical JSON.
    QuestionHash String CODEC(ZSTD(1)),
    Question String CODEC(ZSTD(3)),
    Kind LowCardinality(String) CODEC(ZSTD(1)),
    JudgeModel LowCardinality(String) CODEC(ZSTD(1)),
    InputHash String DEFAULT '' CODEC(ZSTD(1)),
    JudgedColumn LowCardinality(String) DEFAULT '' CODEC(ZSTD(1)),  -- the judged column (input, output, ...); 'monitor' for a monitor; every writer sets it
    KeyVersion UInt16 CODEC(ZSTD(1)),  -- recall reads only the current version

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
ORDER BY (TenantId, TraceId, SpanId, QuestionHash, JudgeModel, InputHash, JudgedColumn, SourceId, JudgedAt)
TTL IF(_retention_days > 0, toDateTime(OccurredAt) + toIntervalDay(_retention_days), toDateTime('2106-01-01')) DELETE
SETTINGS index_granularity = 8192${CLICKHOUSE_STORAGE_POLICY_SETTING};
```

Why this shape:

- **The sort key leads with the trace.** `(TenantId, TraceId, SpanId, QuestionHash, JudgeModel, InputHash)` is the recall key, and its first three columns are the trace page's read. Both are prefix reads.
- **`InputHash` is in the key.** `eval(input, 'q')` and `eval(output, 'q')` on one trace are two rows, and recall serves each its own verdict. `JudgedColumn` names the column and follows `InputHash` in the key, so a reader can tell the two apart after the text changes, and two rows never collapse even if a hash is wrong.
- **`SourceId, JudgedAt` end the key.** Every judgment is kept: a rerun, a "judge again" or a monitor re-evaluating the same trace adds a row. An exact retry of one insert has the same `JudgedAt`, so the replacing merge collapses it. `Source` and `SourceId` are provenance only, and recall never reads them. A row is shared by every source that judges the same text with the same question and judge. A wrong or forged `SourceId` cannot change which verdict recall returns.
- **`KeyVersion`** is the recall epoch. Recall and readers read only rows with the current version. Every row is written with the current version, including rows written while writes are on and recall is off, so recall serves them once it is switched on. A version bump is only for a key bug: it retires the rows written under it, from recall and from the drawer.
- **The partition and TTL anchor on `OccurredAt`**, the trace's time. `trace_summaries` uses the same anchor (`ttl.reconciler.ts:139-145`) and the same `toYearWeek` partition (00002 line 179). So a result expires with its trace.
- **The TTL clause** is what `buildRetentionTTLExpression` emits for a `TABLE_TTL_CONFIG` entry with `retentionTTLColumn: "OccurredAt"` (`ttl.reconciler.ts:327-331`). With cold storage off, the reconciler finds it correct and issues no ALTER. With `CLICKHOUSE_COLD_STORAGE_ENABLED` on, `planTieredTTL` (`ttl.reconciler.ts:438-475`) adds `TO VOLUME 'cold'`, as for every tiered table.
- **The bloom filter on `SourceId`** serves provenance reads, such as "what did this monitor or widget write". It does not serve the run results page: a recall adds no row, so a rerun's recalled traces have no row with its id. The run page keeps reading `instant_eval_judgments` (section 3). The pattern is the `idx_trace_id` bloom filter on `evaluation_runs` (00002).
- **No judged text is stored**, as in 00097. `InputHash` is a hash of the judged text, not the text.
- **A judgment of free text with no trace is not stored.** It has no trace to link to.
- **`Question` is customer text.** The question is free text the customer wrote, so it is tenant data: it lives under `TenantId`, is read only through `InstantEvalApi` like every other column, and expires with the row by the trace's retention. The judged trace text is the part that is never stored.

The migration is one new goose file with the next free number, created with `IF NOT EXISTS`. It is a new table, not an ALTER of `instant_eval_judgments`, because that table's sort key cannot change in place.

### 2. Append-only, recall first

Before judging, the service looks up the rows that match tenant, trace, span, question hash, judge model, input hash and the current `KeyVersion`, with `Status = judged`. It reuses a match: when several rows match, the one with the latest `JudgedAt`; on equal `JudgedAt`, the latest `UpdatedAt`, then the greatest `SourceId`, so the pick is deterministic. It judges only the misses, then writes them in one bulk insert. A recall adds no row.

- **Only judged rows are reused.** A failed or skipped row never blocks a retry.
- **Recall splits a unit.** A text is judged only for its missed questions; a unit with no misses is dropped. The budget check runs on what is left.
- **Trace and span keys only.** A thread-keyed or text-keyed `eval()` has no single trace, so it is judged as today and not stored. A run over threads writes only `instant_eval_judgments`, as today, and gets no recall.
- **Every read filters `TenantId` first** and carries an `OccurredAt` window, so the cold-scan detector stays quiet.
- **Flags.** Writes sit behind `release_instant_evals`. Recall and the drawer section, on every path including monitors, sit behind a new flag, `release_instant_eval_results`.
- **A recall makes no judge call**, so it is free, and every viewer of the same widget or ask gets the same row.
- **The table is the cache.** There is no separate cache with its own expiry.
- **A new row is added only when something changed:** a new judge model, an explicit "judge again", or changed judged text (`InputHash`). Both rows are kept with their times, because a judge is not deterministic.
- **Readers show the latest verdict, labelled.** They read the current `KeyVersion` only, like recall: a bump is a key fix, and its old rows are not trusted. They take the latest judged row per trace, span, question and `JudgedColumn`, by (`JudgedAt`, `UpdatedAt`, `SourceId`) as recall does (`argMax`, as `clickhouse.instant-eval-judgments.repository.ts:28-45` does today with `UpdatedAt`), and show its `JudgeModel` and `JudgedAt` with it. So `eval(input, 'q')` and `eval(output, 'q')` stay two results, a newer verdict replaces an older one, and a judge change hides no past result. `JudgeModel` binds recall, not reads, so after a judge change the drawer and a recall can show different verdicts, each labelled with its judge. A failed or skipped row shows only where no judged row exists. A reader that wants history reads every row.
- **The threshold is not in the hash.** A pass is `Probability >= threshold`, applied on read (`instant-eval-verdicts.rules.ts:49-54`). Two viewers with different thresholds share the same judge call.

Each trigger uses the same path:

| Trigger            | `Source`    | `SourceId`      | What recall gives                                         |
| ------------------ | ----------- | --------------- | --------------------------------------------------------- |
| Quick `eval()` ask | `ask`       | the query id    | A repeat question is free and stays the same answer.      |
| Run                | `run`       | the run id      | A rerun pays only for traces it has not judged. A trace or span run writes both tables: `instant_eval_judgments` for its run page, `eval_results` for recall. |
| Dashboard widget   | `dashboard` | the widget id   | A refresh pays only for new traces. All viewers agree.    |
| Monitor, Instant Evals judge | `monitor` | the monitor id | A trace a monitor already judged with the same question is not judged again. A monitor hashes `{input, output, contexts}`, an ask hashes one column, so monitor rows and ask rows do not recall each other. |

### 3. The trace page reads this table

The trace drawer shows every result on its trace, labelled by source. `eval_results` is owned by the instant-eval module. A plain read of another module's table is a query on its owner's `*Api` (`dev/docs/ARCHITECTURE.md` section 7, "A ClickHouse table has one owner"). So instant-eval adds a results-by-trace query to `InstantEvalApi`. Trace calls it through a channel bound to that token (section 5, "A channel may be bound to another module's `*Api` token"). A binding makes no peer edge, so it is allowed although instant-eval already depends on `TraceApi` (`instant-eval.app.ts:152-157`, `static dependencies`).

The run page, the Explorer `eval:"q"` chip and the `analytics.judgments` LWQL view stay on `instant_eval_judgments`, which runs keep writing. The chip filters one run and reads the `Passed` stored at write, and the view's public columns are run-shaped (`RunId`, `QuestionId`, `Passed`); neither fits `eval_results`. Whether they move is the open question on run storage.

### 4. Retention follows the trace

Three changes make a result expire with its trace. Each follows a pattern already in the repo.

1. **Stamp at write.** Each row gets the project's trace retention in `_retention_days`, from `DataRetentionApi.getRetentionDays({ projectId, category: "traces" })` (`data-retention.api.ts:36`). `evaluation_runs` does the same with `context.retentionPolicy?.traces` (`evaluation-run.store.ts:36`).
2. **Enrol the table in the cascade.** Add `eval_results: "traces"` to `RETENTION_TABLE_CATEGORY_MAP` (`retention-tables.ts:8-28`). When a project's retention changes, the retroactive repository rewrites `_retention_days` for every table in that map (`clickhouse.retroactive-retention.repository.ts:113-160`). That rewrite is one of the cross-module ALTERs `dev/docs/ARCHITECTURE.md` section 9.1 names as a break; `eval_results` joins it as every trace-retained table does today, and moves with them when instant-eval reacts to the retention fact on its own side.
3. **Add a `TABLE_TTL_CONFIG` entry** with `ttlColumn` and `retentionTTLColumn` set to `OccurredAt`, `envVar: CLICKHOUSE_COLD_STORAGE_EVAL_RESULTS_TTL_DAYS` and `hardcodedDefault: 49` like its neighbours (`ttl.reconciler.ts:28`), for cold storage and the TTL check.

Enrolment also adds the table to the storage meter (`PRODUCTION_STORAGE_METER_TABLES`, `retention-tables.ts:114-116`), which sums `_size_bytes`. We list `eval_results` in `TABLES_WITHOUT_SIZE_COLUMN` (`retention-tables.ts:107-112`), as the analytics tables are. So `eval_results` is not counted by the storage meter. That is accepted: a row holds a verdict and the question text, not the judged trace text, so it is small next to the trace it belongs to.

Purge and erase: user erase today touches Postgres only (`prisma.user-data-erase.repository.ts`) and reaches no ClickHouse table, `instant_eval_judgments` included. Organization purge and erase move to the owner shape of `dev/docs/ARCHITECTURE.md` section 9.1; when they do, instant-eval removes its own `eval_results` rows, `Question` text included. Until then a row expires by retention, like its trace.

### 5. Monitors stay separate; their Instant Evals judgments land here too

The rule: every Instant Evals judgment is a row in `eval_results`, whoever asked. Drew decided this on 2026-10-29 (Laze): there is no reason to couple monitors and instant evals, but "the instant evals that a monitor uses should go in the table".

- **A monitor on the Instant Evals judge** (`evaluation-execution.service.ts:360`, `instantEvalJudgeOf`) recalls from `eval_results` first, then judges the miss, and writes the row with `Source = monitor`. It still writes its result to `evaluation_runs`, so its charts, the `evaluations.passed` filter and its triggers do not change.
- **A monitor on any other judge** (another LLM, a built-in check) is not touched. It writes `evaluation_runs` only.
- **Nothing moves out of `evaluation_runs`.** There is no phase 2. The monitor lifecycle, charts, filters and triggers stay with the evaluation module.
- **The trace page reads two stores** and labels the source. A `Source = monitor` row in `eval_results` has its twin in `evaluation_runs`, so the drawer shows it once: from `evaluation_runs`, and skips `monitor` rows from `eval_results`.
- **Ownership.** `eval_results` stays with instant-eval. The evaluation module binds `InstantEvalApi` in a channel (precedent: `analytics.channels.ts`) and calls one recall-or-write method. A binding is not a peer edge, so ADR-174 decision 13 holds.
- **Keys.** The trace id and the raw judgement are passed through `EvaluationJudgingService.answer`. `SpanId` is empty. `InputHash` covers `{input, output, contexts}`. A recalled verdict still goes through `augmentResult` with the current dropped categories.
- **Never fails the run.** Guardrail calls and calls with no trace skip recall and write. The recall read and the insert run under a named timeout (`EVAL_RESULTS_MONITOR_TIMEOUT_MS`, 300 ms). An error is logged and the monitor run goes on. Cost: one prefix read per evaluation on the Instant Evals judge.

## Alternatives considered

### Split by use (the first draft's Option D)

A quick `eval()` stays unsaved, a run keeps its own table, and a dashboard that must stay current is a monitor on the instant evals judge.

Rejected. It treats a trigger (the monitor) as a store. It gives Langy three answers to teach. A quick ask never shows on its trace, and every dashboard refresh pays again. A monitor cannot go back over old traces.

### Cache only

Keep verdicts for a short time, keyed by model, question and text hash. No row lasts past the window.

Rejected. The trace page and dashboards get no lasting result. When the cache expires, viewers see a new number. An append-only table with recall gives the same saving with no expiry and no second source of truth.

### One `lw.evaluation.reported` event per result, folded into `evaluation_runs`

Reuse the collector write-back path (`trace-collector-dispatch.service.ts:219`, `reportOneEvaluation`).

Rejected for instant evals. A run of 100,000 rows and 10 questions is 1,000,000 events, each with fold and analytics rows, written one by one. The same run in `eval_results` is 200 bulk inserts of up to 5,000 rows: one insert per page of 500 source rows times 10 questions (`instant-eval-judge-page.service.ts:452`). `evaluation_runs` is keyed by `EvaluationId`, so a recall by trace and question is not a prefix read. Its lifecycle columns (scheduled, started, attempts) do not apply to an instant verdict.

## How others do it

From public documentation read on 2026-10-28. All four keep results beside the trace, linked by id, and none rewrites the judged data. None documents a cache-only mode.

| Product   | Model                                                                         | Source                                                                                                  |
| --------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Langfuse  | A score is its own object linked to a trace or observation, with a source.   | https://langfuse.com/docs/evaluation/scores/data-model                                                  |
| Braintrust | Scores sit on the span, or in a scoring span added to the trace.             | https://www.braintrust.dev/docs/observe/score-online                                                    |
| Phoenix   | Evaluations are span annotations keyed by `span_id`.                        | https://arize.com/docs/phoenix/tracing/how-to-tracing/feedback-and-annotations/llm-evaluations          |
| Datadog   | Evaluations join on span and trace id and show on the span.                  | https://docs.datadoghq.com/llm_observability/evaluations/submit_evaluations/                            |

## Decisions on the open questions

Drew accepted both on 2026-10-29 (Convoz ask 12563, then Laze).

1. **Monitors into the one table?** No: monitors stay separate, for good, and nothing moves out of `evaluation_runs`. But a monitor's Instant Evals judgments also land in `eval_results` (section 5). This replaces the first answer, "later".
2. **Does changed judged text count as "something changed"?** Yes. The text is read anyway to judge, and a trace can gain spans after its first judgment. Without it, a recall can return a verdict on text that is no longer there.

Two more were asked as pictures in the Laze deck. On 2026-11-10, @lw-instant-evals took their recommended answers under the rule that a reversible step goes ahead (Convoz 526 #24370). Either can be changed by saying so.

3. **Do runs keep their own table?** Yes, for now. A run keeps writing `instant_eval_judgments` for its run page, chip and view, and also writes `eval_results` for recall (sections 2 and 3). Moving the run page onto `eval_results` is a later change.
4. **Are threads stored?** No. Traces and spans are stored and recalled; a thread-keyed `eval()` is judged each time, as today (section 2).

## Risks

- **Concurrent misses.** Two viewers who open a new widget at the same moment can both miss and both judge. Both rows are kept and readers take the latest. A single-flight lock per key is a later fix if the cost shows.
- **The hosted judge changes under one id.** Recall keys on `JudgeModel`. If `langwatch/instant-evals` (`instant-eval-judge.api.ts:122`) changes its weights without a new id, recall serves old verdicts. A new judge version must change the id the row records.
- **Dashboard reads are not prefix reads.** A widget reads by question over a time window, and the key leads with the trace. Partitions prune by `OccurredAt` and the `QuestionHash` bloom filter skips granules. This is unmeasured. If it is slow, add a time-leading rollup as ADR-034 did for evaluations.
- **The key cap.** A quick `eval()` refuses above 1,000 trace keys (`langwatch-ql-app-function-shapes.rules.ts:96-103`). Whether a recalled key counts toward the cap goes to the build PLAN.
- **The chip and the view see runs only.** Results from asks, dashboards and monitors show in the trace drawer, not in the `eval:"q"` chip or `analytics.judgments`, until those move (section 3).
- **A key version bump starts recall over.** After a bump, every recall misses: dashboard widgets, asks, runs and monitors pay to judge again, and the drawer shows no Instant Evals result on a trace until something judges it (monitor results still show from `evaluation_runs`). A bump is only for a key bug, when the old rows cannot be trusted, so this is accepted.
- **The drawer can lag the text.** After a trace's text changes, the drawer shows the last verdict with its time until something judges the new text; an ask on the new text misses, judges, and the drawer then shows that.
- **Old judgments.** `instant_eval_judgments` keeps its rows with no expiry, and runs keep writing it. A copy into `eval_results` is its own plan: an old row has no question text, `QuestionHash`, `JudgeModel` or `InputHash`, so the copy must rebuild them losslessly from `instant_eval_runs.Questions` and the run's judge before it may run. Rows it cannot rebuild are not copied and recall does not serve them. The old table is not dropped while the run page, the Explorer chip or the LWQL view read it; any drop is an operator step, never a goose file.

## Consequences

- Langy gives one answer: "Every eval result is saved on its trace. Asking the same question again is free unless the judge changed."
- The trace drawer shows instant eval results beside monitor results, labelled by source.
- A dashboard widget with `eval()` pays only for new traces, and every viewer of it sees the same number.
- A quick `eval()` now writes rows. It costs one recall read and one bulk insert per query.
- Instant eval results follow the trace's retention, not "never expire".
- Monitors keep writing `evaluation_runs`. A monitor on the Instant Evals judge also writes `eval_results` and gets recall.
- A trace or span run writes two tables: `instant_eval_judgments` for its run page, chip and view, and `eval_results` for recall.
- A run writes every verdict it delivers to `instant_eval_judgments`, recalled or judged, so its run page stays complete. The usage report (`usage-report.ts:394-396`) counts those rows, so once recall is on it counts delivered run verdicts, recalled ones included, not judge calls. Asks, dashboards and monitors are not counted, as today. Counting judge calls from `eval_results` is its own change, planned with the first writer of `eval_results`, the build step after the table in https://github.com/langwatch/langwatch/pull/9172.

## References

- ADR-034: event-sourced analytics materialisation: `dev/docs/adr/034-event-sourced-analytics-materialization.md`
- ADR-153: an Instant Eval run is a judgment job: `dev/docs/adr/153-instant-eval-run-is-a-judgment-job.md`
- ADR-174: the judge call is metered: `dev/docs/adr/174-instant-evals-judge-call-is-metered.md`
- ADR-182: the decision model is a Default models column: `dev/docs/adr/182-instant-evals-decision-model-is-a-default-model-column.md`
- Review of the first draft: https://github.com/langwatch/langwatch/pull/9129
- Issue: https://github.com/langwatch/tasks/issues/986
