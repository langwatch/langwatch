/**
 * The two reads the scope capability resolves itself from. The graph is keyed
 * by the signed-in user beside the procedure's own key, so a user switch never
 * reads the previous user's organization.
 */

import { trpcQueryKey, type ModuleApiClient, type ModuleApiMap } from "@langwatch/api/web";
import type { UiScopeOrganization } from "@langwatch/organization-contract";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

/** The untyped client every feature Provider is handed. */
export type UiFeatureApiTransport = ModuleApiClient<ModuleApiMap>;

export const UI_ORGANIZATIONS_PROCEDURE = "organization.getScopeGraph";
/** The demo project's organization is not the caller's, so only `getAll` carries it. */
export const UI_DEMO_ORGANIZATIONS_PROCEDURE = "organization.getAll";
export const UI_SHARED_TRACE_PROCEDURE = "sharedTrace.get";

export type UiSharedProject = {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
};

export type UiSharedTraceRead = { readonly project: UiSharedProject };

/**
 * The mirror and the focus gate own freshness: this read declares no stale time
 * and no focus refetch. The graph is shared with the application's own queries.
 */
export function useUiOrganizations({
  transport,
  isDemo,
  enabled,
  userId,
}: {
  transport: UiFeatureApiTransport;
  isDemo: boolean;
  enabled: boolean;
  userId: string | undefined;
}): UseQueryResult<readonly UiScopeOrganization[]> {
  const procedure = isDemo ? UI_DEMO_ORGANIZATIONS_PROCEDURE : UI_ORGANIZATIONS_PROCEDURE;
  const input = isDemo ? { isDemo } : {};
  const [path, options] = trpcQueryKey(procedure, { input, type: "query" });
  return useQuery({
    queryKey: [path, { ...options, userId }],
    queryFn: () => transport.query(procedure, input) as Promise<readonly UiScopeOrganization[]>,
    enabled,
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
