/**
 * Watches the queries a widget frame runs, so the host knows each one's completeness report
 * and whether it failed for good. Wraps the executor the frame calls; changes nothing it sends.
 */

import { useCallback, useState } from "react";

import {
  recordQueryFailure,
  recordQueryResult,
  type WidgetQueryRecords,
} from "../model/dashboard-widget/widget-completeness.ts";
import { type ChartFrameExecuteQuery, toChartQueryErrorPayload } from "./frame-bridge.ts";

export function useWidgetQueryRecords({ executeQuery }: { executeQuery: ChartFrameExecuteQuery }) {
  const [records, setRecords] = useState<WidgetQueryRecords>({});

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
    [executeQuery],
  );

  /** Forgets every answer, for a Retry that starts the widget over. */
  const reset = useCallback(() => setRecords({}), []);

  return { executeQuery: watchedExecuteQuery, records, reset };
}
