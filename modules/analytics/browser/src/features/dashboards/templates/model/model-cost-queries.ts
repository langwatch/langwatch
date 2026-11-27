/**
 * Spend per model over the page period, from trace_metrics so the widget's sources apply (the
 * per-minute rollup keeps no origin). A trace's one cost splits evenly between its models.
 * `among` keeps the models another query lists, so a top list always has its models' costs.
 */

import { firstTraceMetricsRow, inPeriod } from "./lwql-period.ts";

export const costByModelSql = ({
  limit,
  among,
}: {
  limit: number;
  among?: string;
}) => `SELECT model,
  sum(TotalCost / length(Models)) AS cost
FROM (SELECT arrayJoin(Models) AS model, Models, TotalCost
  FROM trace_metrics
  WHERE ${inPeriod("OccurredAt")}
    AND ${firstTraceMetricsRow()}
    AND notEmpty(Models))
WHERE model != ''${among ? `\n  AND model IN (SELECT model FROM (${among}))` : ""}
GROUP BY model
ORDER BY cost DESC
LIMIT ${limit}`;
