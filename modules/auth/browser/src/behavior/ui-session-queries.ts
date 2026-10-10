/**
 * The read a session host service is built out of — cached under the
 * key `trpcQueryKey` would produce for the same procedure, so this
 * package's queries and the application's own share ONE cache entry.
 */

import { trpcQueryKey, type ModuleApiClient, type ModuleApiMap } from "@langwatch/api/web";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

/** The untyped client every feature Provider is handed. */
export type UiFeatureApiTransport = ModuleApiClient<ModuleApiMap>;

export const UI_EFFECTIVE_PERMISSIONS_PROCEDURE = "authz.effectivePermissions";

/**
 * Grants refetch on focus rather than caching for the session: a role
 * changed through the API, the SDK or another tab has to reach the open page.
 */
const GRANTS_STALE_TIME_MS = 30_000;

export type UiEffectivePermissionsRead = { readonly permissions: readonly string[] };

/**
 * What the caller may do in one scope — the narrower id wins: a project
 * id names the scope, and the organization id is sent only when there is
 * no project to ask about.
 */
export function useUiEffectivePermissions({
  transport,
  projectId,
  organizationId,
  userId,
  isPublicRoute,
}: {
  transport: UiFeatureApiTransport;
  projectId: string | undefined;
  organizationId: string | undefined;
  /** Keeps a previous user's cached grants from reaching the next user. */
  userId: string | undefined;
  /** A public page holds no grant, so none is asked for there. */
  isPublicRoute: boolean;
}): UseQueryResult<UiEffectivePermissionsRead> {
  const input = {
    ...(projectId ? { projectId } : {}),
    ...(!projectId && organizationId ? { organizationId } : {}),
  };
  return useQuery({
    queryKey: [
      ...trpcQueryKey(UI_EFFECTIVE_PERMISSIONS_PROCEDURE, { input, type: "query" }),
      userId ?? "anonymous",
    ],
    queryFn: () =>
      transport.query(
        UI_EFFECTIVE_PERMISSIONS_PROCEDURE,
        input,
      ) as Promise<UiEffectivePermissionsRead>,
    enabled: !isPublicRoute && !!userId && (!!projectId || !!organizationId),
    staleTime: GRANTS_STALE_TIME_MS,
  });
}
