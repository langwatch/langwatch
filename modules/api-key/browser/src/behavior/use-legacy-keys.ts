import type { OutputsFromMap } from "@langwatch/api/web";

import { type ApiKeyApiMap, apiKeyApi } from "./api-key-api.ts";

/** One organisation project whose legacy key still authenticates. Never the key. */
export type LegacyProjectKey = OutputsFromMap<ApiKeyApiMap>["project"]["legacyKeys"][number];

/**
 * Every project in the organisation whose legacy key still authenticates. The
 * screen is organisation-wide, so the nudge is too: the server answers only the
 * projects this reader may manage, and drops a project once its key is revoked.
 */
export function useLegacyKeys({ organizationId }: { organizationId: string }): {
  keys: LegacyProjectKey[];
  isLoading: boolean;
} {
  const legacyKeys = apiKeyApi.project.legacyKeys.useQuery(
    { organizationId },
    { enabled: !!organizationId, retry: false },
  );

  return { keys: legacyKeys.data ?? [], isLoading: legacyKeys.isLoading };
}
