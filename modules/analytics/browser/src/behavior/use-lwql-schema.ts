import type { LangWatchQLSchema } from "@langwatch/analytics-contract";

import { analyticsApi } from "./analytics-api.ts";

const SCHEMA_STALE_MS = 60_000;

/**
 * The schema the SQL editor completes against. A failed read leaves it undefined, and the
 * editor keeps editing with keywords only.
 */
export function useLwqlSchema({ projectId }: { projectId: string }): LangWatchQLSchema | undefined {
  const query = analyticsApi.analytics.lwql.schema.useQuery(
    { projectId },
    {
      enabled: projectId.length > 0,
      retry: false,
      staleTime: SCHEMA_STALE_MS,
      refetchOnWindowFocus: false,
    },
  );
  return query.data;
}
