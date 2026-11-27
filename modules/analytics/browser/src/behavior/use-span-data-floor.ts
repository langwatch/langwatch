import type { SpanDataFloor } from "../model/dashboard-widget/span-data-floor.ts";
import { analyticsApi } from "./analytics-api.ts";

/** Where span_metrics' history starts (ADR-006); null while loading or on error. */
export function useSpanDataFloor({ projectId }: { projectId: string }): SpanDataFloor | null {
  const query = analyticsApi.analytics.lwql.spanDataFloor.useQuery(
    { projectId },
    { enabled: projectId.length > 0, retry: false, staleTime: 5 * 60_000 },
  );

  return query.data ?? null;
}
