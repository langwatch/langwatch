/**
 * LangWatchQL for "Release check": scenario runs read as test runs (one batch is one
 * run of a suite), experiment runs read as model and test-set comparisons, and
 * production read before and after the newest change.
 */

import { END, inPeriod, START } from "../../templates/model/lwql-period.ts";
import { LAST_CHANGE_AT } from "./change-queries.ts";

/** The evaluators an extraction test run scores fields with, each 0 to 1 per document. */
export const FIELD_PRECISION_JUDGE = "Field precision";
export const FIELD_RECALL_JUDGE = "Field recall";

const JUDGED_RUNS = `${inPeriod("StartedAt")}
  AND ArchivedAt IS NULL
  AND Verdict IS NOT NULL`;

/** Each scenario's last ten runs in the period, oldest first as a 1/0 strip. */
export const FLAKY_SCENARIOS_SQL = `SELECT ScenarioId AS scenario,
  any(Name) AS name,
  arrayStringConcat(arrayMap(run -> if(tupleElement(run, 2), '1', '0'),
    arraySort(run -> tupleElement(run, 1), groupArray(tuple(StartedAt, Verdict = 'success')))),
    '') AS strip,
  countIf(Verdict = 'success') AS passed,
  count() AS runs
FROM (
  SELECT ScenarioId, Name, StartedAt, Verdict,
    row_number() OVER (PARTITION BY ScenarioId ORDER BY StartedAt DESC) AS recency
  FROM simulations
  WHERE ${JUDGED_RUNS}
)
WHERE recency <= 10
GROUP BY scenario
ORDER BY passed > 0 AND passed < runs DESC, passed / runs ASC
LIMIT 30`;

const NEWEST_BATCH = `(SELECT argMax(BatchRunId, StartedAt) FROM simulations WHERE ${JUDGED_RUNS})`;

/**
 * Pass counts per scenario in the newest batch against every earlier batch of the
 * period, for the scenarios the newest batch ran.
 */
export const NEW_VERSION_SCENARIOS_SQL = `WITH ${NEWEST_BATCH} AS newest
SELECT ScenarioId AS scenario,
  any(Name) AS name,
  countIf(BatchRunId = newest AND Verdict = 'success') AS new_passed,
  countIf(BatchRunId = newest) AS new_runs,
  countIf(BatchRunId != newest AND Verdict = 'success') AS current_passed,
  countIf(BatchRunId != newest) AS current_runs
FROM simulations
WHERE ${JUDGED_RUNS}
GROUP BY scenario
HAVING new_runs > 0 AND current_runs > 0
ORDER BY new_passed / new_runs - current_passed / current_runs ASC
LIMIT 100`;

/** What each scenario run cost: the newest figure per trace it recorded, summed. */
const RUN_COSTS = `SELECT ScenarioRunId, sum(cost) AS cost
  FROM (
    SELECT ScenarioRunId, TraceId, argMax(TotalCost, OccurredAt) AS cost
    FROM simulation_trace_metrics
    WHERE OccurredAt >= ${START}
    GROUP BY ScenarioRunId, TraceId
  )
  GROUP BY ScenarioRunId`;

const RUNS_WITH_COST = `SELECT s.ScenarioRunId AS run_id, s.ScenarioId AS scenario_id,
    s.BatchRunId AS batch, s.ScenarioSetId AS suite, s.StartedAt AS started_at,
    s.Verdict = 'success' AS passed, s.DurationMs AS duration_ms,
    length(s.MetCriteria) AS met, length(s.MetCriteria) + length(s.UnmetCriteria) AS criteria,
    ifNull(c.cost, 0) AS cost
  FROM simulations AS s
  LEFT JOIN (${RUN_COSTS}) AS c ON c.ScenarioRunId = s.ScenarioRunId
  WHERE ${inPeriod("s.StartedAt")}
    AND s.ArchivedAt IS NULL
    AND s.Verdict IS NOT NULL`;

/** Typical run time and cost per run, newest batch against the earlier ones. */
export const NEW_VERSION_COST_SQL = `WITH ${NEWEST_BATCH} AS newest
SELECT batch = newest AS is_new,
  min(started_at) AS started_at,
  median(duration_ms) AS typical_ms,
  avg(cost) AS cost_per_run
FROM (${RUNS_WITH_COST})
WHERE scenario_id IN (SELECT ScenarioId FROM simulations WHERE BatchRunId = newest)
GROUP BY is_new`;

const NEWEST_SUITE = `(SELECT argMax(ScenarioSetId, StartedAt) FROM simulations WHERE ${JUDGED_RUNS})`;

/** The last five runs of the suite that ran last, newest first. */
export const LAST_RUNS_SQL = `WITH ${NEWEST_SUITE} AS newest_suite
SELECT batch,
  min(started_at) AS started_at,
  count() AS scenarios,
  countIf(passed) AS passed,
  sum(met) AS met,
  sum(criteria) AS criteria,
  median(duration_ms) AS typical_ms,
  avg(cost) AS cost_per_scenario
FROM (${RUNS_WITH_COST})
WHERE suite = newest_suite
GROUP BY batch
ORDER BY started_at DESC
LIMIT 5`;

/** Experiment runs that put two or more targets side by side in the period. */
const COMPARING_RUNS = `SELECT RunId
  FROM experiment_items
  WHERE ${inPeriod("OccurredAt")}
  GROUP BY RunId
  HAVING uniqExact(TargetId) >= 2`;

/** Each run's targets, named by their model, else by the target's own name. */
const RUN_TARGETS = `SELECT DISTINCT RunId, JSONExtractString(target, 'id') AS target_id,
    coalesce(nullIf(JSONExtractString(target, 'model'), ''),
      JSONExtractString(target, 'name')) AS setup
  FROM experiment_run_results
  ARRAY JOIN JSONExtractArrayRaw(Targets) AS target
  WHERE ${inPeriod("StartedAt")}`;

/** Pass rate, cost per row and p95 reply per model or setup, best quality first. */
export const MODEL_COMPARISON_SQL = `SELECT t.setup AS setup,
  countIf(i.Passed = 1) / nullIf(countIf(i.Passed IS NOT NULL), 0) AS pass_rate,
  countIf(i.Passed IS NOT NULL) AS graded,
  sumIf(i.TargetCost, i.ResultType = 'target') / nullIf(countIf(i.ResultType = 'target'), 0)
    AS cost_per_row,
  quantileExactIf(0.95)(i.TargetDurationMs, i.ResultType = 'target') AS p95_ms
FROM experiment_items AS i
INNER JOIN (${RUN_TARGETS}) AS t ON t.RunId = i.RunId AND t.target_id = i.TargetId
WHERE ${inPeriod("i.OccurredAt")}
  AND i.RunId IN (${COMPARING_RUNS})
GROUP BY setup
ORDER BY pass_rate DESC, cost_per_row ASC
LIMIT 5`;

/** Each judged row of an experiment run, with the topic its target's trace landed in. */
const JUDGED_ROWS = `SELECT e.RunId AS run_id, ifNull(m.TopicId, '') AS topic,
    countIf(e.Passed = 1) AS passed, count() AS judged
  FROM experiment_items AS e
  LEFT JOIN (
    SELECT RunId, RowIndex, TargetId, any(TraceId) AS trace_id
    FROM experiment_items
    WHERE ${inPeriod("OccurredAt")} AND ResultType = 'target'
    GROUP BY RunId, RowIndex, TargetId
  ) AS r ON r.RunId = e.RunId AND r.RowIndex = e.RowIndex AND r.TargetId = e.TargetId
  LEFT JOIN (
    SELECT TraceId, TopicId FROM trace_metrics WHERE OccurredAt >= subtractDays(${START}, 1)
  ) AS m ON m.TraceId = r.trace_id
  WHERE ${inPeriod("e.OccurredAt")}
    AND e.ResultType = 'evaluator'
    AND e.Passed IS NOT NULL
  GROUP BY run_id, topic`;

/** Production's share of traces per topic; LangWatch's own runs are left out. */
const PRODUCTION_MIX = `SELECT ifNull(TopicId, '') AS topic, count() / sum(count()) OVER () AS share
  FROM trace_metrics
  WHERE ${inPeriod("OccurredAt")} AND Origin IN ('', 'application')
  GROUP BY topic`;

/**
 * Pass rate of the last six runs of the experiment that ran last, as run and weighted
 * to production's topic mix: each topic's pass rate times its share of real traffic.
 */
export const TEST_SET_RUNS_SQL = `SELECT x.RunId AS run_id,
  any(x.StartedAt) AS started_at,
  sum(j.passed) / nullIf(sum(j.judged), 0) AS pass_rate,
  sumIf(ifNull(p.share, 0) * j.passed / j.judged, j.judged > 0)
    / nullIf(sumIf(ifNull(p.share, 0), j.judged > 0), 0) AS weighted_rate,
  sum(j.judged) AS judged
FROM experiment_run_results AS x
INNER JOIN (${JUDGED_ROWS}) AS j ON j.run_id = x.RunId
LEFT JOIN (${PRODUCTION_MIX}) AS p ON p.topic = j.topic
WHERE ${inPeriod("x.StartedAt")}
  AND x.ExperimentId = (SELECT argMax(ExperimentId, StartedAt) FROM experiment_run_results
    WHERE ${inPeriod("StartedAt")})
GROUP BY run_id
ORDER BY started_at DESC
LIMIT 6`;

/** Average field precision and recall of each of the last 12 test runs. */
export const FIELD_ACCURACY_RUNS_SQL = `SELECT RunId AS run_id,
  min(OccurredAt) AS started_at,
  avgIf(Score, EvaluatorName = '${FIELD_PRECISION_JUDGE}') AS precision_score,
  avgIf(Score, EvaluatorName = '${FIELD_RECALL_JUDGE}') AS recall_score,
  uniqExact(RowIndex) AS documents
FROM experiment_items
WHERE ${inPeriod("OccurredAt")}
  AND ResultType = 'evaluator'
  AND EvaluatorName IN ('${FIELD_PRECISION_JUDGE}', '${FIELD_RECALL_JUDGE}')
  AND Score IS NOT NULL
GROUP BY run_id
ORDER BY started_at DESC
LIMIT 12`;

/** The windows around the newest change: up to 7 days after it, and a week before that. */
const AROUND_CHANGE = `${LAST_CHANGE_AT} AS changed_at,
  least(addDays(changed_at, 7), ${END}) AS after_end,
  subtractDays(changed_at, 7) AS before_start,
  subtractDays(after_end, 7) AS before_end`;

const inAfter = (column: string) => `${column} >= changed_at AND ${column} < after_end`;
const inBefore = (column: string) => `${column} >= before_start AND ${column} < before_end`;

/** Production before and after the newest change: traces, errors, p95 and cost per trace. */
export const ROLLOUT_TRAFFIC_SQL = `WITH ${AROUND_CHANGE}
SELECT ${inAfter("OccurredAt")} AS after,
  count() AS traces,
  countIf(HasError) / count() AS error_rate,
  quantileExact(0.95)(TotalDurationMs) AS p95_ms,
  sum(ifNull(TotalCost, 0)) / count() AS cost_per_trace
FROM trace_metrics
WHERE changed_at > toDateTime(0)
  AND (${inAfter("OccurredAt")} OR ${inBefore("OccurredAt")})
GROUP BY after`;

/**
 * Checks passed on the traces before and after the newest change, the after side
 * reweighted to the before side's topic mix, so a shift in what users ask does not
 * read as a regression. A check counts on its trace's time, not when it ran.
 */
export const ROLLOUT_CHECKS_SQL = `WITH ${AROUND_CHANGE}
SELECT sum(before_passed) / nullIf(sum(before_judged), 0) AS before_rate,
  sum(after_passed) / nullIf(sum(after_judged), 0) AS after_rate,
  sumIf(before_judged * after_passed / after_judged, after_judged > 0)
    / nullIf(sumIf(before_judged, after_judged > 0), 0) AS after_even_rate,
  sum(before_judged) AS before_checks,
  sum(after_judged) AS after_checks
FROM (
  SELECT ifNull(t.TopicId, '') AS topic,
    countIf(${inBefore("t.OccurredAt")} AND e.Passed = 1) AS before_passed,
    countIf(${inBefore("t.OccurredAt")}) AS before_judged,
    countIf(${inAfter("t.OccurredAt")} AND e.Passed = 1) AS after_passed,
    countIf(${inAfter("t.OccurredAt")}) AS after_judged
  FROM evaluation_metrics AS e
  INNER JOIN (
    SELECT TraceId, TopicId, OccurredAt
    FROM trace_metrics
    WHERE ${inAfter("OccurredAt")} OR ${inBefore("OccurredAt")}
  ) AS t ON t.TraceId = e.TraceId
  WHERE changed_at > toDateTime(0)
    AND e.Passed IS NOT NULL
    AND e.OccurredAt >= before_start
  GROUP BY topic
)`;
