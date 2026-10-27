import type { OutputsFromMap } from "@langwatch/api/web";

import { type ApiKeyApiMap, apiKeyApi } from "./api-key-api.ts";

/** The project's legacy key while it still authenticates, or null once it is gone. */
export type LegacyKeyStatus = Pick<
  OutputsFromMap<ApiKeyApiMap>["project"]["getLegacyKeyStatus"],
  "lastUsedAt"
>;

/**
 * The project's legacy key, if it still works. The server answers only those with
 * `project:manage`, so a reader without it is never asked for the status at all.
 */
export function useLegacyKey({
  projectId,
  canManageProject,
}: {
  projectId: string | undefined;
  canManageProject: boolean;
}): LegacyKeyStatus | null {
  const status = apiKeyApi.project.getLegacyKeyStatus.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId && canManageProject, retry: false },
  );
  if (status.data?.present !== true) return null;
  return { lastUsedAt: status.data.lastUsedAt };
}
