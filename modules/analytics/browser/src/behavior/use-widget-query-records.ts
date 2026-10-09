/**
 * Watches the queries a widget frame runs, so the host knows each one's completeness report,
 * whether it failed for good, and the rows it last returned, which "Export CSV" writes. Wraps
 * the executor the frame calls; changes nothing it sends.
 */

import { useCallback, useState } from "react";

import {
  recordQueryFailure,
  recordQueryResult,
  type WidgetQueryRecords,
} from "../model/dashboard-widget/widget-completeness.ts";
import {
  recordQueryExport,
  type WidgetExportPeriod,
  type WidgetQueryResults,
} from "../model/dashboard-widget/widget-export.ts";
import { type ChartFrameExecuteQuery, toChartQueryErrorPayload } from "./frame-bridge.ts";

export function useWidgetQueryRecords({
  executeQuery,
  timeWindow,
}: {
  executeQuery: ChartFrameExecuteQuery;
  /** The period `executeQuery` runs over, which a kept result is stamped with. */
  timeWindow: WidgetExportPeriod;
}) {
  const [records, setRecords] = useState<WidgetQueryRecords>({});
  const [results, setResults] = useState<WidgetQueryResults>({});

  const watchedExecuteQuery: ChartFrameExecuteQuery = useCallback(
    async (args) => {
      try {
        const result = await executeQuery(args);
        setRecords((previous) =>
          recordQueryResult({
            records: previous,
            queryName: args.queryName,
            completeness: result.completeness,
          }),
        );
        setResults((previous) =>
          recordQueryExport({
            results: previous,
            queryName: args.queryName,
            result,
            period: timeWindow,
          }),
        );
        return result;
      } catch (error) {
        // An aborted query was dropped by the frame (a restart, a newer run), not refused.
        if (!args.signal.aborted) {
          setRecords((previous) =>
            recordQueryFailure({
              records: previous,
              queryName: args.queryName,
              error: toChartQueryErrorPayload(error),
            }),
          );
        }
        throw error;
      }
    },
    [executeQuery, timeWindow],
  );

  /** Forgets every answer, for a Retry that starts the widget over. */
  const reset = useCallback(() => {
    setRecords({});
    setResults({});
  }, []);

  return { executeQuery: watchedExecuteQuery, records, results, reset };
}
