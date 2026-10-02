import type { LangWatchQLSchema } from "@langwatch/analytics-contract";

import { analyticsApi } from "./analytics-api.ts";

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
    },
  );
  return query.data;
}
