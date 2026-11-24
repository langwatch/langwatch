/**
 * Spend per model over the page period, from trace_metrics so the widget's sources apply: the
 * per-minute rollup keeps no origin and would count Langy's turns and simulations too. A trace
 * keeps one cost, so a trace that used several models splits it evenly between them.
 */

import { inPeriod } from "./lwql-period.ts";

export const costByModelSql = ({ limit }: { limit: number }) => `SELECT model,
  sum(TotalCost / length(Models)) AS cost
FROM (SELECT arrayJoin(Models) AS model, Models, TotalCost
  FROM trace_metrics
  WHERE ${inPeriod("OccurredAt")}
    AND notEmpty(Models))
WHERE model != ''
GROUP BY model
ORDER BY cost DESC
LIMIT ${limit}`;
