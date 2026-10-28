# ADR-189: Where instant eval results live

**Date:** 2026-10-28

**Status:** Proposed

> One line: a quick `eval()` in a query is not saved. A saved run is stored in `instant_eval_judgments`, shows on each trace beside monitor results, and feeds dashboards. Monitors stay as they are. Nothing is written into `evaluation_runs` by default.

## Context

- Issue: https://github.com/langwatch/tasks/issues/986
- On 2026-10-27, Drew and Rogerio talked in Slack about where instant eval results should be stored. The team has no agreed model. Langy gave different answers to the same question.
- The thread raised four options. This record names them A to D, describes what each one means in this code base, and recommends one.
- Instant evals are used in three ways: exploring (a person or Langy asks ad-hoc questions), dashboards (the same eval is read many times), and alerts (a monitor judges each new trace). Each use needs a different thing from storage.
- This record builds on ADR-153 (a run is a judgment job), ADR-174 (the judge call is metered) and ADR-182 (the decision model is a Default models column).

## 1. Today

### 1.1 Online evals (monitors)

A monitor runs an evaluator on each new trace. The run is an event stream, and the events fold into one ClickHouse table.

- The events are `lw.evaluation.*` (scheduled, started, completed, reported, attempt failed). See `modules/evaluation/contract/src/evaluation-event.constants.ts:10-16`.
- They fold into `evaluation_runs`. See `packages/clickhouse-migrations/migrations/00002_create_schema.sql:188`. The table is `ReplacingMergeTree(UpdatedAt)`, `PARTITION BY toYearWeek(ScheduledAt)`, `ORDER BY (TenantId, EvaluationId)`.
- Retention has two parts. The TTL reconciler gives a default of 49 days (`packages/clickhouse-migrations/src/ttl.reconciler.ts:42-51`). Each row also carries the project retention in days, stamped by `modules/evaluation/process/src/eventing/evaluation-run.store.ts:36`.
- The same events also feed `evaluation_analytics` (migration 00041) and `evaluation_analytics_rollup` (migration 00040). The wiring is in `modules/evaluation/process/src/eventing/evaluation-processing-stores.pipeline.ts`.
- The trace drawer reads the runs through `modules/trace/process/src/repositories/clickhouse/trace-evaluation-runs.repository.ts`. The cards are in `modules/trace/browser/src/ui/sections/explorer/trace-drawer/eval-cards/`.
- A monitor can use the instant evals judge. Its model id is `langwatch/instant-evals` (ADR-174 decision 11). The check is in `modules/evaluation/process/src/rules/instant-eval-judge-dispatch.rules.ts:23`. Such a monitor lands in `evaluation_runs` like any other: one verdict, one spend, one reported event per call.

### 1.2 Instant evals inside LWQL

LWQL has the functions `eval`, `eval_criteria`, `eval_passed`, `eval_score`, `eval_category` and `eval_category_probs`. See `specs/lwql/eval-functions.feature`.

A synchronous query stores nothing.

- `InstantEvalQueryJudgingService.judgeQuery` holds the budget, judges the rows, and records one spend. See `modules/instant-eval/process/src/services/instant-eval-query-judging.service.ts:67`.
- `judgeRows` keeps the verdicts in an in-memory `Map` for the length of the call only. See `modules/instant-eval/process/src/services/instant-eval-judge-rows.service.ts:67`.
- The only caches are the 60 second free-budget ledger read and the 30 second Connect opt-in. Neither holds a verdict.

### 1.3 Instant Eval runs

A run is started from the search bar, from the CLI (`langwatch instant-eval run`), or from REST (`modules/instant-eval/process/src/transport/instant-eval.rest.ts`).

- A run is stored in two tables: `instant_eval_runs` (the definition and the counters) and `instant_eval_judgments` (one row per verdict). See migrations `00098_create_instant_eval_runs.sql` and `00097_create_instant_eval_judgments.sql`.
- Judgments are `ReplacingMergeTree(UpdatedAt)`, `PARTITION BY toYYYYMM(CreatedAt)`, `ORDER BY (TenantId, RunId, TraceId, SpanId, QuestionId)`. They hold verdict fields only, never the judged text. Retention is indefinite by default.
- One page (up to 500 rows times the questions) is one bulk insert, made by the page intent (ADR-153 section 4).
- Two surfaces read judgments today. The Explorer `eval:"question"` chip reads them (`modules/trace/process/src/features/query/rules/trace-query-instant-eval-fields.rules.ts`). The LWQL dataset `analytics.judgments` reads them (`modules/analytics/process/src/rules/lwql-view-catalog.rules.ts:2278`).
- The trace drawer does not read judgments. Nothing under `trace-drawer` reads them.
- ADR-153 section 1 deferred an opt-in mirror of judgments into `evaluation_runs`. It was not built.

### 1.4 Langy

Langy has no store of its own. It calls `explorer.runInstantEval` (`specs/langy/langy-trace-explorer-actions.feature`) or the CLI and REST. So its results are ordinary runs. The capability is listed in `modules/langy/contract/src/cards/capability-catalog.ts:171`.

### 1.5 Dashboards

- A dashboard widget is an LWQL statement. It goes through the same `LangWatchQLService` as any query.
- Nothing seen in the code blocks `eval()` inside a widget. The gate is the `release_instant_evals` flag (`modules/analytics/process/src/rules/lwql-access.rules.ts:16`). If a widget used `eval()`, it would judge synchronously on every refresh, with no cache.
- This is inferred, not traced end to end. No catalogue widget uses `eval()` today.
- The built-in eval charts read `evaluation_analytics_rollup`, `evaluation_analytics` and `evaluation_runs`. These hold monitor results only.
- A widget could read `analytics.judgments`. Nothing ties a widget to a run.

### 1.6 Collector write-back

A write-back path exists. The trace collector accepts an `evaluations` array. Each result becomes one `lw.evaluation.reported` event. See `modules/trace/process/src/features/ingestion/services/trace-collector-dispatch.service.ts:219` (`reportOneEvaluation`). This is the path Option B would reuse.

### 1.7 Summary

| Use                                      | Stored?  | Where                                                         | On trace details? | On dashboards?                                 |
| ---------------------------------------- | -------- | ------------------------------------------------------------- | ----------------- | ---------------------------------------------- |
| Monitor (online eval)                    | Yes      | `evaluation_runs` (49 days by default, plus per-project days) | Yes               | Yes, built-in eval charts                      |
| Monitor with the instant evals judge     | Yes      | `evaluation_runs`                                             | Yes               | Yes, built-in eval charts                      |
| Sync `eval()` in LWQL                    | No       | In memory for the call only                                   | No                | Possible by inference, judges on every refresh |
| Instant Eval run (search bar, CLI, REST) | Yes      | `instant_eval_runs` and `instant_eval_judgments` (indefinite) | No                | Only by reading `analytics.judgments` in LWQL  |
| Langy                                    | As a run | Same as a run                                                 | No                | Same as a run                                  |
| Collector `evaluations` array            | Yes      | `evaluation_runs`                                             | Yes               | Yes                                            |

## 2. Use cases and volumes

### 2.1 The three uses

| Use              | Shape                                                                                               | What storage must give                                 |
| ---------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Exploration      | A person or Langy asks ad-hoc questions. Hundreds of questions a session. Each answer is read once. | Speed and low cost. Nothing needs to last.             |
| Dashboard        | One eval, read many times, by many people.                                                          | Stable numbers. No judging on each page load.          |
| Alert or monitor | Continuous. Each new trace is judged.                                                               | A result per trace that a filter or an alert can read. |

### 2.2 The real limits

| Constant                            | Value                                                                                                                | File                                                                                                          |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `LWQL_APP_FUNCTION_KEY_CAPS`        | trace 1,000; span 1,000; text 1,000; thread 200 keys per sync `eval()`. Over the cap is a refusal, not a truncation. | `modules/analytics/process/src/features/app-functions/rules/langwatch-ql-app-function-shapes.rules.ts:96-103` |
| `LWQL_MAX_RESULT_ROWS`              | 10,000                                                                                                               | `modules/analytics/contract/src/features/lwql/langwatch-ql-limits.ts:19`                                      |
| `LWQL_MAX_RESULT_BYTES`             | 8,000,000                                                                                                            | same file, line 22                                                                                            |
| LWQL statement time and concurrency | 10 s per statement; 10 concurrent queries per user                                                                   | same file, `DEFAULT_LWQL_RESOURCE_LIMITS`                                                                     |
| `INSTANT_EVAL_QUERY_TOKEN_BUDGET`   | 4,000,000 input tokens per sync query                                                                                | `modules/instant-eval/contract/src/instant-eval.config.ts`                                                    |
| `INSTANT_EVAL_DEFAULT_ROW_CAP`      | 10,000 rows per run                                                                                                  | `modules/instant-eval/contract/src/instant-eval-limits.ts:10`                                                 |
| `INSTANT_EVAL_MAX_ROW_CAP`          | 100,000 rows per run, paid plans                                                                                     | same file, line 13                                                                                            |
| `INSTANT_EVAL_PAGE_SIZE`            | 500 rows per page (100 when the average text is above 12 KiB)                                                        | `modules/instant-eval/process/src/rules/instant-eval-run-sizing.rules.ts`                                     |
| `INSTANT_EVAL_JUDGE_CONCURRENCY`    | 128 judge calls in flight                                                                                            | `modules/instant-eval/process/src/services/instant-eval-judge-rows.service.ts:29`                             |
| Rate limits                         | 300,000 input tokens per second for the deployment; 150,000 per project                                              | `modules/instant-eval-judge/contract/src/instant-eval-judge.config.ts`                                        |
| `INSTANT_EVAL_FREE_BUDGET_USD`      | 1 USD per organisation that is not billed                                                                            | `modules/instant-eval-judge/contract/src/instant-eval-pricing.ts:68`                                          |
| Price                               | 0.042 USD per million input tokens, markup 1.3                                                                       | same file, lines 10-11                                                                                        |
| Classifier input                    | 32,000 state tokens                                                                                                  | `modules/instant-eval-judge/contract/src/instant-eval-judge.api.ts:290`                                       |
| `INSTANT_EVAL_AUTO_RUN_USD`         | 0.5 USD: above this the search bar asks to confirm                                                                   | `modules/trace/browser/src/ui/sections/explorer/search-bar/use-instant-eval-route.ts:31`                      |

### 2.3 Worked volumes (derived, not measured)

A verdict is one row per question per judged text. So the row count is rows times questions.

| Run                        | Verdicts  | As `evaluation_runs` write-back          | As `instant_eval_judgments`    |
| -------------------------- | --------- | ---------------------------------------- | ------------------------------ |
| 10,000 rows, 3 questions   | 30,000    | 30,000 events and 30,000 fold rows       | 20 bulk inserts of 1,500 rows  |
| 100,000 rows, 10 questions | 1,000,000 | 1,000,000 events and 1,000,000 fold rows | 200 bulk inserts of 5,000 rows |

The arithmetic for the first line: 10,000 rows at 500 rows a page is 20 pages. Each page holds 500 rows times 3 questions, so one insert of 1,500 rows. The second line: 100,000 at 500 is 200 pages, and each page is 500 times 10, so 5,000 rows.

The page size is 500 at best. It drops to 100 for long texts, which makes the page count five times larger and the insert smaller. The shape stays the same: one insert per page, not one event per verdict.

## 3. Options

### Option A: Cache only

How it works: keep verdicts for a short time in a cache keyed by model, question and a hash of the text. Nothing is durable. A repeat of the same eval inside the window is free.

- Pros
  - The cheapest to build.
  - No new table and no retention rule.
  - Repeat questions in one session cost nothing.
- Cons
  - Nothing survives. A dashboard cannot rely on it.
  - A person cannot share a result or come back to it.
  - Trace details cannot show a verdict.
  - The cache key hides the text, so a cache hit gives no run to point at.
- Consequences
  - Cost: judging is paid again after the window ends. A dashboard that refreshes outside the window pays each time.
  - ClickHouse load: none.
  - Trace details UI: no change, no verdicts shown.
  - Langy's answer: "Results are kept for a short time, then gone."
  - Migration: none.

### Option B: Write each result back as a trace evaluation

How it works: each verdict becomes a `lw.evaluation.reported` event on the trace. It folds into `evaluation_runs`. This is the ADR-153 mirror, made the default for every run and every query. The collector write-back path in section 1.6 already does this for external results.

- Pros
  - Trace details already show these. No new UI for the drawer.
  - The `evaluations.passed` filter and the built-in eval charts work at once.
  - One store for all evaluation results.
- Cons
  - One event and one fold row per verdict. A 100,000 row run with 10 questions makes 1,000,000 of each.
  - Ad-hoc exploration runs mix into monitor charts and into the `evaluations.passed` filters. A person who asked a one-off question changes the numbers that an alert reads.
  - Retention does not match. `evaluation_runs` keeps 49 days by default and the project days. Judgments are kept without limit today.
  - A dedup key is needed. A rerun of the same question on the same trace must replace the old verdict, not add a second one. `evaluation_runs` is keyed by `EvaluationId`, so each run needs a stable id per trace and question.
  - It changes the meaning of "monitor result". A verdict with no monitor behind it has no monitor to link to.
- Consequences
  - Cost: judge cost is unchanged. Write cost grows with verdicts, not with pages.
  - ClickHouse load: high. Events, fold rows, and the analytics tables all grow per verdict.
  - Trace details UI: shows verdicts with no new work, but it cannot tell a run from a monitor unless a source field is added.
  - Langy's answer: "Every result is saved on the trace." This is true, and it hides the cost.
  - Migration: a source field on events, a dedup rule, and a decision on retention. Old runs stay in `instant_eval_judgments` unless copied.

### Option C: Own ClickHouse table, bulk inserted, shown on trace details

How it works: this is `instant_eval_judgments`. It exists. Pages are inserted in bulk. What is missing is a trace-drawer read, which joins by `TenantId` and `TraceId`, and a path for dashboards.

- Pros
  - Built and in use. The Explorer chip and LWQL already read it.
  - Cheapest on ClickHouse: one insert per page.
  - Keeps ad-hoc results out of monitor charts.
  - Verdict fields only, so no judged text is stored twice.
  - The run gives every verdict a name and an owner (the run), so a dashboard can point at it.
- Cons
  - Two stores for evaluation results, with two filter words: `evaluations.passed` and `eval:"question"`.
  - The trace drawer needs new work: a read, and a card that says it is an Instant Eval run.
  - Retention is indefinite, so a judgment can outlive its trace.
  - Sync `eval()` still stores nothing, so exploration is not covered.
- Consequences
  - Cost: the same as today. The drawer read adds one query per opened trace.
  - ClickHouse load: low for writes. A lookup by trace alone is not a prefix of the order key, so the drawer read may cost more (see section 6).
  - Trace details UI: new section, built in the trace module through the instant-eval module's Api, not its table.
  - Langy's answer: "A run is saved and shows on each trace."
  - Migration: probably none for the table. A secondary index or a trace-first projection may be needed for the drawer read.

### Option D: Split by use

How it works: use a different answer for each use.

- Sync `eval()` for exploration stores nothing. This is today.
- Anything that must last (a dashboard, a shared result, a verdict on trace details) is a run, stored as in Option C.
- An optional B-style mirror into `evaluation_runs` is allowed per run, opt-in, for the cases where a run must drive a filter or an alert.

- Pros
  - Each use gets the cost it needs: nothing for exploration, bulk pages for runs, events only when asked.
  - Matches how the products in section 4 work: a separate linked record, not a rewrite of the trace.
  - Mostly built. The new work is the drawer read and the dashboard binding.
  - Gives Langy one clear sentence.
- Cons
  - Three answers, not one. The team must teach the split.
  - The dashboard binding is new product work.
  - The opt-in mirror keeps the dedup and retention questions of Option B, but only for the runs that ask for it.
- Consequences
  - Cost: judge cost is paid once per run, not per refresh.
  - ClickHouse load: low by default, higher only for mirrored runs.
  - Trace details UI: shows judgments from runs, labelled as an Instant Eval run.
  - Langy's answer: see section 5.
  - Migration: no change to existing runs. A mirror flag is added on the run later, if needed.

### Comparison

|                                        | A: Cache only | B: Write back                | C: Own table               | D: Split by use                            |
| -------------------------------------- | ------------- | ---------------------------- | -------------------------- | ------------------------------------------ |
| Survives the session                   | No            | Yes                          | Yes                        | Yes, for runs                              |
| On trace details                       | No            | Yes, at once                 | Needs a drawer read        | Needs a drawer read                        |
| Dashboards                             | No            | Yes, but mixes with monitors | Needs a run binding        | Needs a run binding                        |
| ClickHouse load for 1,000,000 verdicts | None          | 1,000,000 events and rows    | 200 inserts (derived)      | 200 inserts, plus events for mirrored runs |
| Ad-hoc runs pollute monitor charts     | No            | Yes                          | No                         | No, unless mirrored                        |
| Retention                              | None          | 49 days or project days      | Indefinite                 | Indefinite, mirror follows monitors        |
| New work                               | Small         | Medium (source field, dedup) | Medium (drawer, dashboard) | Medium (drawer, dashboard, split)          |
| Exploration covered                    | Yes           | Costly                       | No                         | Yes                                        |

## 4. How others do it

These notes come from public documentation read on 2026-10-28. An item marked unconfirmed was not seen in a page that states it.

### Braintrust

- Online scoring writes score spans as children of the scored span: https://www.braintrust.dev/docs/observe/score-online
- Ad-hoc "Score existing logs": https://www.braintrust.dev/docs/guides/logs/score
- A span has a `scores` dictionary. A rewrite overwrites the old score: https://www.braintrust.dev/docs/core/logs/write
- Playground runs are overwritten. "+ Experiment" saves a snapshot. This is the closest thing to an ephemeral mode: https://www.braintrust.dev/docs/evaluate/playgrounds
- Scores are metered. Starter has 10K free, then 2.50 USD per 1K: https://www.braintrust.dev/pricing

### Langfuse

- A score is a separate object. It references a trace, an observation, a session or a dataset run. Its source is API, EVAL or ANNOTATION. A score config is optional: https://langfuse.com/docs/evaluation/scores/data-model
- LLM-as-a-judge writes scores back. Observation level is recommended: https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge
- Manual batch evaluation runs on selected items: https://langfuse.com/docs/evaluation/core-concepts
- Backfill reaches up to 6 months or 25,000 observations. Unconfirmed: this came from a search snippet only: https://langfuse.com/changelog/2026-09-07-evaluator-backfills
- ClickHouse holds scores: https://langfuse.com/self-hosting
- No mode that does not persist is documented.

### Arize Phoenix

- Evaluations are logged as span annotations keyed by `span_id`: https://arize.com/docs/phoenix/tracing/how-to-tracing/feedback-and-annotations/llm-evaluations
- The trace tree shows annotation badges: https://arize.com/docs/phoenix/release-notes/10-2026/10-01-2026-trace-tree-evals-and-decision-spans
- Storage and pricing are unconfirmed.

### Datadog LLM Observability

- Managed evaluations attach to a span: https://docs.datadoghq.com/llm_observability/evaluations/managed_evaluations/
- Custom LLM judges can sample to control cost. Results show on the span Evaluations tab. They can be queried as `@evaluation.<name>.value` and used in monitors. Evaluation tracing adds billed spans: https://docs.datadoghq.com/llm_observability/evaluations/custom_llm_as_a_judge_evaluations/
- `submit_evaluation` joins on span id and trace id, or on a `join_on` tag: https://docs.datadoghq.com/llm_observability/evaluations/submit_evaluations/
- The storage location is unconfirmed.

### The pattern

All four persist results beside the trace. Three of the four keep the result in a separate score or annotation record linked by id. They do not rewrite the trace. None documents a cache-only mode. An ephemeral result exists only as a playground that is overwritten.

This supports a stored, separate, linked record (Options C and D). It does not support cache-only (Option A) as the whole answer. It also shows that sync exploration and a stored run can sit side by side, as a playground and a saved experiment do.

## 5. Recommendation and the one question

We recommend Option D, built on Option C.

1. Sync `eval()` for exploration stores nothing durable. This is today. A verdict cache is an optimisation, not storage, and can come later.
2. The definitive store for instant eval results is `instant_eval_judgments`. It stays separate from `evaluation_runs`.
3. Build the trace-drawer read. A trace then shows its judgments beside the monitor results, labelled as an Instant Eval run.
4. A dashboard eval is a saved run. A widget reads `analytics.judgments`. It does not call sync `eval()` on each refresh.
5. There is no default write-back into `evaluation_runs`. The ADR-153 mirror stays opt-in per run, for the case where a run must drive filters or alerts.
6. Langy gives one answer. It can say: "A quick eval() in a query is not saved. A run is saved, shows on each trace and can feed a dashboard. Monitors are set up ahead and run on new traces."

Why:

- It matches how the other products work: a separate linked record.
- It is the cheapest for ClickHouse: bulk pages, not one event per verdict.
- It keeps monitor charts clean.
- It is mostly built already.

### The one question for Drew

Should a dashboard widget that uses an eval be refused sync `eval()` and be required to point at a saved run (re-run on a schedule), or may it call `eval()` live on each refresh, within the 1,000-key cap?

Our recommendation: point at a saved run.

| Answer                             | What it costs                                                                                                                                                                                                                                                                          |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Point at a saved run (recommended) | New product work: a widget-to-run binding and a schedule. Judge cost is paid once per run. Numbers are stable and every viewer sees the same ones. The numbers go stale until the next run.                                                                                            |
| Call `eval()` live on each refresh | No new work. Judge cost is paid on every refresh by every viewer, with no cache. The cap of 1,000 keys per `eval()` limits the widget to small windows. Two viewers can see different numbers. A busy dashboard can drain the 1 USD free budget of an organisation that is not billed. |

## 6. Open risks and what a build PLAN needs

### Risks

- Retention mismatch. Judgments are kept without limit. Traces follow the project retention. A judgment can outlive its trace, and the drawer would never show it. Someone must decide whether judgments follow trace retention.
- Drawer join cost. The judgments order key starts with `TenantId, RunId`. A lookup by `TraceId` alone is not a prefix of the key. On a large run, this may scan many parts. A skip index or a trace-first projection may be needed. This is unmeasured.
- Stale runs. A saved run does not see new traces. A dashboard needs a schedule to keep up.
- Two vocabularies. Filters on monitor results use `evaluations.passed`. Filters on runs use `eval:"q"`. A user may not know which to use.
- Widgets may call `eval()` today. This is inferred from the code and not traced end to end. It must be verified before the question in section 5 is put to a customer.
- Billing. Nobody is charged yet. The cost of a scheduled run is unknown until it is priced.
- Two places by design. A monitor that uses the instant evals judge already writes `evaluation_runs`. So "instant eval" already lives in two stores. The drawer must label the source so a user can tell them apart.

### What a build PLAN needs

- A trace-drawer read. The trace module's repository must call the instant-eval module's `*Api`, not its table (a module rule).
- A saved or scheduled run concept for dashboards.
- A widget-to-run binding.
- A decision on retention for judgments.
- A Langy prompt and knowledge update, and a Langy scenario that checks the one answer.
- Feature files under `specs/` for the three scenarios in the issue, error paths included.
- The lint and architecture policy checks for the touched paths.
- Proof: a run shows on a trace; a widget reads a saved run; Langy answers the same way each time.

## References

- ADR-153: An Instant Eval run is a judgment job over the same statement, not a monitor run: `dev/docs/adr/153-instant-eval-run-is-a-judgment-job.md`
- ADR-174: An LLM judge on Instant Evals is one metered, budget-checked call: `dev/docs/adr/174-instant-evals-judge-call-is-metered.md`
- ADR-182: The Instant Evals decision model is a Default models column: `dev/docs/adr/182-instant-evals-decision-model-is-a-default-model-column.md`
- ADR-144: Trace search routes on Enter: `dev/docs/adr/144-trace-search-routes-on-enter.md`
- Issue: https://github.com/langwatch/tasks/issues/986
