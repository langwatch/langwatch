import type { TraceHeader } from "@langwatch/trace-contract";
import { useQueryClient } from "@tanstack/react-query";
import { getQueryKey } from "@trpc/react-query";
import { useCallback } from "react";

import { api } from "../../../../behavior/trace-api.ts";
import { traceHeaderPlaceholder } from "../../../../model/traces/trace-header-placeholder.ts";
import { mapTraceListPayload } from "../utils/map-trace-list-payload.ts";

/**
 * A trace's row from any cached `traces.list` page, painted as a header. Placeholder data
 * for the header read: it shows at once and is never stored under the header's key.
 */
export function useTraceListRowHeader() {
  const queryClient = useQueryClient();

  return useCallback(
    (traceId: string): TraceHeader | undefined => {
      const pages = queryClient.getQueriesData<Parameters<typeof mapTraceListPayload>[0]>({
        queryKey: getQueryKey(api.traces.list),
      });
      for (const [, payload] of pages) {
        const row = mapTraceListPayload(payload).find((item) => item.traceId === traceId);
        if (row) return traceHeaderPlaceholder(row);
      }
      return undefined;
    },
    [queryClient],
  );
}
