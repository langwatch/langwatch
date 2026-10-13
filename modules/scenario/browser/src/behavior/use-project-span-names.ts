import { nowInstant } from "@langwatch/time";
import { useMemo } from "react";

import { api } from "./scenario-api.ts";

const SPAN_NAME_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** The span names the project recorded over the last 30 days. */
export function useProjectSpanNames({ projectId }: { projectId: string | undefined }) {
  const endDate = useMemo(() => nowInstant().epochMilliseconds, []);
  const fieldNames = api.traces.getFieldNames.useQuery(
    { projectId: projectId ?? "", startDate: endDate - SPAN_NAME_WINDOW_MS, endDate },
    { enabled: !!projectId },
  );

  return { spanNames: fieldNames.data?.spanNames ?? [] };
}
