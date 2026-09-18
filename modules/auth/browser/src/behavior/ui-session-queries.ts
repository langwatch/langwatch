/**
 * The two reads a session capability is built out of — cached under the
 * key `trpcQueryKey` would produce for the same procedure, so this
 * package's queries and the application's own share ONE cache entry.
 */

import { trpcQueryKey, type ModuleApiClient, type ModuleApiMap } from "@langwatch/api/web";
import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";

/** The untyped client every feature Provider is handed. */
export type UiFeatureApiTransport = ModuleApiClient<ModuleApiMap>;

export const UI_EFFECTIVE_PERMISSIONS_PROCEDURE = "authz.effectivePermissions";
export const UI_FEATURE_FLAG_PROCEDURE = "featureFlag.isEnabled";

/**
 * Grants refetch on focus rather than caching for the session: a role
 * changed through the API, the SDK or another tab has to reach the open page.
 */
const GRANTS_STALE_TIME_MS = 30_000;

/** The server re-reads operator rows every few seconds; the browser holds its answer far longer. */
const FEATURE_FLAG_STALE_TIME_MS = 5 * 60_000;

/**
 * Off the HTTP batch: left in it, these shell-mounted queries wait behind
 * a page's slowest read (seconds, on a drawer-open burst) — the shell is
 * what the page needs FIRST, so it runs on its own connection instead.
 */
const OFF_BATCH = { context: { skipBatch: true } } as const;

export type UiEffectivePermissionsRead = { readonly permissions: readonly string[] };
type UiFeatureFlagRead = { readonly enabled: boolean };

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
}: {
  transport: UiFeatureApiTransport;
  projectId: string | undefined;
  organizationId: string | undefined;
  /** Keeps a previous user's cached grants from reaching the next user. */
  userId: string | undefined;
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
    enabled: !!userId && (!!projectId || !!organizationId),
    staleTime: GRANTS_STALE_TIME_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * `projectId` and `organizationId` are both stated on every read — a
 * targeting rule that names a scope the read left out can never match, so
 * a missing id would turn a per-project rollout into a silent no-op.
 */
export function useUiFeatureFlags({
  transport,
  flags,
  projectId,
  organizationId,
  enabled,
}: {
  transport: UiFeatureApiTransport;
  flags: readonly string[];
  projectId: string | null;
  organizationId: string | null;
  enabled: boolean;
}): ReadonlyMap<string, boolean> {
  return useQueries({
    queries: flags.map((flag) => {
      const input = { flag, projectId, organizationId };
      return {
        queryKey: trpcQueryKey(UI_FEATURE_FLAG_PROCEDURE, { input, type: "query" as const }),
        queryFn: () =>
          transport.query(
            UI_FEATURE_FLAG_PROCEDURE,
            input,
            OFF_BATCH,
          ) as Promise<UiFeatureFlagRead>,
        enabled,
        staleTime: FEATURE_FLAG_STALE_TIME_MS,
        refetchOnWindowFocus: false,
      };
    }),
    combine: (results) => {
      const answers = new Map<string, boolean>();
      results.forEach((result, index) => {
        const flag = flags[index];
        if (flag === void 0 || result.data === void 0) return;
        answers.set(flag, result.data.enabled);
      });
      return answers;
    },
  });
}
