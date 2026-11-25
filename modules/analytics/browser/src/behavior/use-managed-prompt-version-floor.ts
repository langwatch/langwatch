import type { ManagedPromptVersionFloorRead } from "../model/dashboard-widget/managed-prompt-version-floor.ts";
import { analyticsApi } from "./analytics-api.ts";

/** Where LastUsedPromptVersionId is known from (ADR-006): loading, failed, or the answer. */
export function useManagedPromptVersionFloor({
  projectId,
}: {
  projectId: string;
}): ManagedPromptVersionFloorRead {
  const query = analyticsApi.analytics.lwql.managedPromptVersionFloor.useQuery(
    { projectId },
    { enabled: projectId.length > 0, retry: false, staleTime: 5 * 60_000 },
  );

  if (query.data) return { status: "read", floor: query.data };
  if (query.isError) return { status: "failed" };
  return { status: "loading" };
}
