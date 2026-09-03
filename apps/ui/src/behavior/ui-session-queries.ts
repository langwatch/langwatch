/**
 * The four reads a session capability is built out of.
 *
 * Each one runs on the application's transport and is cached under the key
 * `@trpc/react-query` would have produced for the same procedure, so a query
 * this package fires and the same query fired by an application hook are ONE
 * cache entry: the organization graph is read once per document however many
 * halves of the product are mounted, and an invalidation from either side
 * refetches for both. `trpcQueryKey` is what guarantees that — a hand-rolled
 * key would give this package a private cache that no invalidation reaches.
 *
 * The declared result types name only the fields a scope, a permission or a
 * flag decision reads. They are a view of the wire, not the whole of it.
 */

import { trpcQueryKey } from "@langwatch/platform-api-client";
import { useQueries, useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { UiScopeOrganization } from "../model/ui-scope";
import type { UiFeatureApiTransport } from "./ui-feature-transport";

export const UI_ORGANIZATIONS_PROCEDURE = "organization.getAll";
export const UI_EFFECTIVE_PERMISSIONS_PROCEDURE = "authz.effectivePermissions";
export const UI_FEATURE_FLAG_PROCEDURE = "featureFlag.isEnabled";
export const UI_SHARED_TRACE_PROCEDURE = "sharedTrace.get";

/**
 * The organization graph refetches on focus rather than caching for the
 * session: it drives load-bearing client state, and an edit made through the
 * API, the SDK or another tab has to reach the open page.
 */
const ORGANIZATIONS_STALE_TIME_MS = 30_000;

/** The server re-reads the operator rows every few seconds; the browser holds its answer far longer. */
const FEATURE_FLAG_STALE_TIME_MS = 5 * 60_000;

/**
 * Off the HTTP batch.
 *
 * These queries are mounted on the application shell and refetch on focus and
 * on route change. Left in the batch they wait behind a page's slowest read —
 * measured at seconds on a drawer-open burst — and the shell is what the page
 * needs FIRST. On their own connection they run in parallel instead.
 */
const OFF_BATCH = { context: { skipBatch: true } } as const;

export type UiSharedProject = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
};

type UiSharedTraceRead = { readonly project: UiSharedProject };
type UiEffectivePermissionsRead = { readonly permissions: readonly string[] };
type UiFeatureFlagRead = { readonly enabled: boolean };

export function useUiOrganizations({
  transport,
  isDemo,
  enabled,
}: {
  transport: UiFeatureApiTransport;
  isDemo: boolean;
  enabled: boolean;
}): UseQueryResult<readonly UiScopeOrganization[]> {
  const input = { isDemo };
  return useQuery({
    queryKey: trpcQueryKey(UI_ORGANIZATIONS_PROCEDURE, { input, type: "query" }),
    queryFn: () =>
      transport.query(UI_ORGANIZATIONS_PROCEDURE, input, OFF_BATCH) as Promise<
        readonly UiScopeOrganization[]
      >,
    enabled,
    staleTime: ORGANIZATIONS_STALE_TIME_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * The project behind a share token.
 *
 * The share page resolves everything it renders, its chrome included, through
 * this one read; the same key means the page's own copy and this one are a
 * single request. It never refetches: a share token addresses one immutable
 * view, and a viewer has no session for a refetch to pick anything up from.
 */
export function useUiSharedProject({
  transport,
  token,
  enabled,
}: {
  transport: UiFeatureApiTransport;
  token: string;
  enabled: boolean;
}): UseQueryResult<UiSharedTraceRead> {
  const input = { token };
  return useQuery({
    queryKey: trpcQueryKey(UI_SHARED_TRACE_PROCEDURE, { input, type: "query" }),
    queryFn: () => transport.query(UI_SHARED_TRACE_PROCEDURE, input) as Promise<UiSharedTraceRead>,
    enabled,
    staleTime: Infinity,
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * What the caller may do in one scope, answered by the server.
 *
 * The narrower id wins, exactly as the procedure resolves it: a project id
 * names a project scope, and the organization id is sent only when there is no
 * project to ask about.
 */
export function useUiEffectivePermissions({
  transport,
  projectId,
  organizationId,
}: {
  transport: UiFeatureApiTransport;
  projectId: string | undefined;
  organizationId: string | undefined;
}): UseQueryResult<UiEffectivePermissionsRead> {
  const input = {
    ...(projectId ? { projectId } : {}),
    ...(!projectId && organizationId ? { organizationId } : {}),
  };
  return useQuery({
    queryKey: trpcQueryKey(UI_EFFECTIVE_PERMISSIONS_PROCEDURE, { input, type: "query" }),
    queryFn: () =>
      transport.query(
        UI_EFFECTIVE_PERMISSIONS_PROCEDURE,
        input,
      ) as Promise<UiEffectivePermissionsRead>,
    enabled: !!projectId || !!organizationId,
    staleTime: ORGANIZATIONS_STALE_TIME_MS,
    refetchOnWindowFocus: true,
  });
}

/**
 * Every flag a screen has asked about so far, and the answers that arrived.
 *
 * `projectId` and `organizationId` are both stated on every read, because a
 * targeting rule that names a scope the read left out can never match: a
 * missing id turns a per-project rollout into a silent no-op. JSON carries no
 * `undefined`, so "no such scope" travels as null.
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
