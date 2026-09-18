/**
 * The two reads the scope capability resolves itself from — cached under the
 * key `trpcQueryKey` would produce for the same procedure, so this package's
 * queries and the application's own share ONE cache entry.
 */

import { trpcQueryKey, type ModuleApiClient, type ModuleApiMap } from "@langwatch/api/web";
import type { UiScopeOrganization } from "@langwatch/organization-contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

/** The untyped client every feature Provider is handed. */
export type UiFeatureApiTransport = ModuleApiClient<ModuleApiMap>;

export const UI_ORGANIZATIONS_PROCEDURE = "organization.getAll";
export const UI_SHARED_TRACE_PROCEDURE = "sharedTrace.get";

/**
 * The organization graph refetches on focus rather than caching for the
 * session: it drives load-bearing client state, and an edit made through the
 * API, the SDK or another tab has to reach the open page.
 */
const ORGANIZATIONS_STALE_TIME_MS = 30_000;

/**
 * Off the HTTP batch: left in it, these shell-mounted queries wait behind
 * a page's slowest read (seconds, on a drawer-open burst) — the shell is
 * what the page needs FIRST, so it runs on its own connection instead.
 */
const OFF_BATCH = { context: { skipBatch: true } } as const;

export type UiSharedProject = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
};

export type UiSharedTraceRead = { readonly project: UiSharedProject };

export function useUiOrganizations({
  transport,
  isDemo,
  enabled,
  userId,
}: {
  transport: UiFeatureApiTransport;
  isDemo: boolean;
  enabled: boolean;
  /** Keeps one user's organization graph from reaching the next user. */
  userId: string | undefined;
}): UseQueryResult<readonly UiScopeOrganization[]> {
  const input = { isDemo };
  return useQuery({
    queryKey: [
      ...trpcQueryKey(UI_ORGANIZATIONS_PROCEDURE, { input, type: "query" }),
      userId ?? "anonymous",
    ],
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
 * The project behind a share token — the share page resolves everything
 * it renders through this one read. Never refetches: a token addresses
 * one immutable view, and a viewer has no session to pick anything up from.
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
