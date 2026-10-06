/**
 * Whether a widget's source sent any data in the last 90 days: one row if it did,
 * none if it did not. A widget runs this only when its own queries come back
 * empty, to tell a quiet period from a source that was never set up.
 */

import type { WidgetSource } from "./widget-calls-to-action.ts";

/** How far back a source counts as set up. */
export const PRESENCE_DAYS = 90;

const presenceSql = ({ view, column, also }: { view: string; column: string; also?: string }) =>
  `SELECT 1 AS present
FROM ${view}
WHERE ${column} >= subtractDays(now(), ${PRESENCE_DAYS})${also ? `\n  AND ${also}` : ""}
LIMIT 1`;

const TRACES = presenceSql({ view: "trace_metrics", column: "OccurredAt" });
const EVALUATIONS = presenceSql({ view: "evaluation_metrics", column: "OccurredAt" });

export const PRESENCE_SQL: Readonly<Record<WidgetSource, string>> = {
  traces: TRACES,
  requests: TRACES,
  tokens: presenceSql({
    view: "trace_metrics_by_minute",
    column: "BucketStart",
    also: "PromptTokensSum + CompletionTokensSum > 0",
  }),
  models: presenceSql({
    view: "model_usage_by_minute",
    column: "BucketStart",
    also: "Model != ''",
  }),
  spans: presenceSql({ view: "spans", column: "StartTime" }),
  conversations: presenceSql({
    view: "trace_metrics",
    column: "OccurredAt",
    also: "ConversationId IS NOT NULL AND ConversationId != ''",
  }),
  satisfaction: presenceSql({
    view: "traces",
    column: "OccurredAt",
    also: "SatisfactionScore IS NOT NULL",
  }),
  topics: presenceSql({
    view: "trace_metrics",
    column: "OccurredAt",
    also: "TopicId IS NOT NULL AND TopicId != ''",
  }),
  scenarios: presenceSql({ view: "simulations", column: "StartedAt", also: "ArchivedAt IS NULL" }),
  judges: EVALUATIONS,
  evaluations: EVALUATIONS,
  feedback: presenceSql({
    view: "annotations",
    column: "CreatedAt",
    also: "IsThumbsUp IS NOT NULL",
  }),
  gateway: presenceSql({ view: "gateway_request_spend", column: "OccurredAt" }),
  codingAgents: presenceSql({ view: "coding_sessions", column: "StartedAt" }),
};
