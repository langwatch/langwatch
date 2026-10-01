import { nowInstant } from "@langwatch/time";
import { useMemo } from "react";

import { api } from "./scenario-api.ts";

const SPAN_NAME_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const SPAN_NAME_STALE_TIME_MS = 5 * 60 * 1000;

/** The span names the project recorded over the last 30 days. */
export function useProjectSpanNames({ projectId }: { projectId: string | undefined }) {
  const endDate = useMemo(() => nowInstant().epochMilliseconds, []);
  const fieldNames = api.traces.getFieldNames.useQuery(
    { projectId: projectId ?? "", startDate: endDate - SPAN_NAME_WINDOW_MS, endDate },
    { enabled: !!projectId, refetchOnWindowFocus: false, staleTime: SPAN_NAME_STALE_TIME_MS },
  );

  return { spanNames: fieldNames.data?.spanNames ?? [] };
}
