/**
 * Worked LangWatchQL statements, one definition for every reader.
 *
 * The schema endpoint already derives one example per dataset, and that example
 * is deliberately mechanical: three ungated columns, a time predicate, a limit.
 * It proves the dataset is queryable and teaches nothing about the questions
 * people actually ask — a rate over time, a cost breakdown by model, the turns
 * of a conversation, a keyset export. These are those, written once and read by
 * the reference endpoint, the CLI and the MCP server.
 *
 * Every statement is validated rather than reviewed: the drift test runs
 * each one through the LangWatchQL validator against the real catalog and fails
 * when one stops validating, and checks that each declared parameter is one the
 * statement actually binds. A published example the API would refuse is worse
 * than no example, because it costs its reader a round trip to find out.
 *
 * Gates are declared, not inferred: an example naming `TotalCost` needs the
 * `costs` permission, and the reference marks it unavailable for a caller
 * without it rather than hiding it, for the same reason the schema keeps a
 * withheld column listed.
 *
 * @see ../catalog/lwqlViews.ts — the datasets these read
 * @see ../schema.ts — the per-dataset example these sit beside
 * @see specs/analytics/query-reference.feature
 */

import type { QueryExampleIntent } from "../../../app-layer/traces/query-language/examples";
import type { FieldProtection } from "../../../traces/projection/catalog";

/** One bound parameter a statement declares. */
export interface LangWatchQLExampleParameter {
  /** The name inside the braces, without the type. */
  readonly name: string;
  /** The declared ClickHouse type, exactly as the statement writes it. */
  readonly type: string;
  readonly description: string;
}

/** One worked LangWatchQL statement. */
export interface LangWatchQLExample {
  /** Stable identifier, unique across both example libraries. */
  readonly id: string;
  readonly title: string;
  readonly intent: QueryExampleIntent;
  readonly tags: readonly string[];
  /** The statement, exactly as it should be submitted. */
  readonly sql: string;
  /** Parameters the statement binds. Empty when it binds none. */
  readonly parameters: readonly LangWatchQLExampleParameter[];
  /** Permissions the caller must hold for every column this names. */
  readonly gates: readonly FieldProtection[];
  readonly notes?: string;
}

/**
 * The keyset cursor parameter names.
 *
 * Named here rather than spelled in the CLI, because the CLI's `--page-by
 * keyset` rebinds exactly these two between pages and the statement it rebinds
 * them in is the caller's own. Two names in two files is two names that can
 * disagree, and the failure that produces is a paging loop that silently
 * re-reads its first page forever.
 */
export const LWQL_KEYSET_AFTER_TIMESTAMP_PARAMETER = "after_ts";
export const LWQL_KEYSET_AFTER_ID_PARAMETER = "after_id";

/**
 * The library.
 *
 * Every statement bounds its dataset's time column, because that predicate is
 * what prunes partitions: without it the read touches every partition the
 * tenant has, including the cold ones on object storage. An example that omits
 * it would teach the one habit the catalog exists to discourage.
 */
export const LWQL_EXAMPLES: readonly LangWatchQLExample[] = [
  {
    id: "lwql.recent-failures",
    title: "The most recent traces that failed",
    intent: "triage",
    tags: ["errors", "starter"],
    sql: `SELECT TraceId, TraceName, OccurredAt, TotalDurationMs
FROM analytics.traces
WHERE OccurredAt >= subtractDays(now(), 1)
  AND ContainsErrorStatus
ORDER BY OccurredAt DESC
LIMIT 100`,
    parameters: [],
    gates: [],
  },
  {
    id: "lwql.error-rate-by-day",
    title: "Error rate per day over a month",
    intent: "triage",
    tags: ["errors", "time-series", "rates"],
    sql: `SELECT
  toStartOfDay(OccurredAt) AS day,
  count() AS traces,
  countIf(ContainsErrorStatus) AS errors
FROM analytics.traces
WHERE OccurredAt >= subtractDays(now(), 30)
GROUP BY day
ORDER BY day`,
    parameters: [],
    gates: [],
    notes:
      "A rate is two counts, not a division: keep the numerator and the denominator as columns so a zero-denominator bucket reads as zero traffic rather than as a null rate.",
  },
  {
    id: "lwql.latency-percentiles",
    title: "Latency percentiles over a week",
    intent: "latency",
    tags: ["latency", "percentiles"],
    sql: `SELECT
  quantile(0.5)(TotalDurationMs) AS p50_ms,
  quantile(0.95)(TotalDurationMs) AS p95_ms,
  quantile(0.99)(TotalDurationMs) AS p99_ms
FROM analytics.traces
WHERE OccurredAt >= subtractDays(now(), 7)`,
    parameters: [],
    gates: [],
  },
  {
    id: "lwql.throughput-by-hour",
    title: "Traffic and errors per hour from the rollup",
    intent: "triage",
    tags: ["time-series", "rollups"],
    sql: `SELECT
  toStartOfHour(BucketStart) AS hour,
  sum(TraceCount) AS traces,
  sum(ErrorCount) AS errors
FROM analytics.trace_metrics_by_minute
WHERE BucketStart >= subtractDays(now(), 2)
GROUP BY hour
ORDER BY hour`,
    parameters: [],
    gates: [],
    notes:
      "The per-minute rollup is already aggregated, so this reads far less than the same question over `traces`. Prefer it whenever the answer is a count or a sum over time.",
  },
  {
    id: "lwql.cost-by-model",
    title: "Spend and tokens by model over a week",
    intent: "cost",
    tags: ["cost", "models", "rollups"],
    sql: `SELECT
  Model,
  sum(CostSum) AS cost_usd,
  sum(PromptTokensSum + CompletionTokensSum) AS tokens
FROM analytics.model_usage_by_minute
WHERE BucketStart >= subtractDays(now(), 7)
GROUP BY Model
ORDER BY cost_usd DESC
LIMIT 50`,
    parameters: [],
    gates: ["costs"],
  },
  {
    id: "lwql.busiest-conversations",
    title: "The longest conversations of the week",
    intent: "conversations",
    tags: ["conversations"],
    sql: `SELECT
  ConversationId,
  count() AS turns,
  min(OccurredAt) AS started_at,
  max(OccurredAt) AS last_turn
FROM analytics.trace_metrics
WHERE OccurredAt >= subtractDays(now(), 7)
  AND ConversationId IS NOT NULL
GROUP BY ConversationId
ORDER BY turns DESC
LIMIT 50`,
    parameters: [],
    gates: [],
    notes:
      "`trace_metrics` is the dataset that carries conversation, user and customer identity. There is no conversations dataset: a conversation is a group of traces sharing this id.",
  },
  {
    id: "lwql.evaluator-pass-rate",
    title: "Pass rate per evaluator",
    intent: "quality",
    tags: ["evaluations", "rates"],
    sql: `SELECT
  EvaluatorName,
  count() AS evaluations,
  countIf(Passed = 1) AS passed
FROM analytics.evaluations
WHERE ScheduledAt >= subtractDays(now(), 7)
  AND Status = 'processed'
GROUP BY EvaluatorName
ORDER BY evaluations DESC
LIMIT 50`,
    parameters: [],
    gates: [],
    notes:
      "Filter on a processed status: scheduled, skipped and errored rows carry no verdict and would dilute the rate.",
  },
  {
    id: "lwql.slowest-span-per-trace",
    title: "Which traces have the slowest single span",
    intent: "latency",
    tags: ["latency", "spans", "joins"],
    sql: `SELECT
  t.TraceId AS TraceId,
  t.TraceName AS TraceName,
  count() AS spans,
  max(s.DurationMs) AS slowest_span_ms
FROM analytics.traces AS t
INNER JOIN analytics.spans AS s
  ON s.TenantId = t.TenantId AND s.TraceId = t.TraceId
WHERE t.OccurredAt >= subtractDays(now(), 1)
  AND s.StartTime >= subtractDays(now(), 1)
GROUP BY TraceId, TraceName
ORDER BY slowest_span_ms DESC
LIMIT 50`,
    parameters: [],
    gates: [],
    notes:
      "Bound the time column on BOTH sides of a join. The join key does not prune partitions, so a predicate on one side alone leaves the other side reading all of time.",
  },
  {
    id: "lwql.traces-for-one-user",
    title: "One user's traces, with the lookback as a parameter",
    intent: "discovery",
    tags: ["users", "attributes", "parameters"],
    sql: `SELECT
  TraceId,
  OccurredAt,
  Attributes['langwatch.user_id'] AS user_id
FROM analytics.traces
WHERE OccurredAt >= subtractDays(now(), {days:UInt32})
  AND Attributes['langwatch.user_id'] = {user_id:String}
ORDER BY OccurredAt DESC
LIMIT 100`,
    parameters: [
      { name: "days", type: "UInt32", description: "How far back to look." },
      {
        name: "user_id",
        type: "String",
        description: "The user id as it was sent on the trace.",
      },
    ],
    gates: [],
    notes:
      "Read one attribute key by name. Never select the whole `Attributes` map: it is the widest column on the dataset and almost none of it is the answer.",
  },
  {
    id: "lwql.recent-simulation-failures",
    title: "Simulation runs that failed",
    intent: "quality",
    tags: ["simulations"],
    sql: `SELECT ScenarioRunId, Name, Verdict, StartedAt
FROM analytics.simulations
WHERE StartedAt >= subtractDays(now(), 7)
  AND Verdict = 'failure'
ORDER BY StartedAt DESC
LIMIT 50`,
    parameters: [],
    gates: [],
  },
  {
    id: "lwql.keyset-export",
    title: "Export captured input and output, page by page",
    intent: "export",
    tags: ["export", "paging", "parameters"],
    sql: `SELECT OccurredAt AS after_ts, TraceId AS after_id, CapturedInput, CapturedOutput
FROM analytics.traces
WHERE OccurredAt >= subtractDays(now(), 7)
  AND (OccurredAt, TraceId) > ({after_ts:DateTime64(3)}, {after_id:String})
ORDER BY OccurredAt, TraceId
LIMIT 1000`,
    parameters: [
      {
        name: LWQL_KEYSET_AFTER_TIMESTAMP_PARAMETER,
        type: "DateTime64(3)",
        description:
          "The previous page's last `OccurredAt`. Start from '1970-01-01 00:00:00.000'.",
      },
      {
        name: LWQL_KEYSET_AFTER_ID_PARAMETER,
        type: "String",
        description:
          "The previous page's last `TraceId`. Start from the empty string.",
      },
    ],
    gates: ["input", "output"],
    notes:
      "The query API has no pagination of its own. This is the shape that pages without rewriting the statement, which is what `langwatch query --page-by keyset` rebinds between pages. The two ordering columns are aliased to the cursor parameters' own names, which is where the next page's cursor is read from: alias whichever columns you order by, or the walk cannot tell them from any other value in the row.",
  },
];
