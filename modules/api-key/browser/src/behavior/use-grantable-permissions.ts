/**
 * What a restricted key's permission rows may offer, asked of the server that mints it: the
 * same resolver the mint's ceiling check runs, so access held through a group, a team or an
 * inherited role unlocks exactly the rows the mint will accept. A service key's ceiling is
 * every categorizable permission, its mint being an organization admin's.
 */

import { categorizablePermissions } from "@langwatch/api-key-contract";
import { useMemo } from "react";

import { apiKeyApi } from "./api-key-api.ts";

type Scope = { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string };

export function useGrantablePermissions({
  organizationId,
  scopes,
  ownerUserId,
  isServiceKey,
  enabled,
}: {
  organizationId: string;
  scopes: Scope[];
  /** The personal key's owner, when an admin assigns it to someone else. */
  ownerUserId?: string;
  isServiceKey: boolean;
  enabled: boolean;
}): { permissions: string[]; isLoading: boolean; isError: boolean; refetch: () => unknown } {
  const named = scopes.filter((scope) => scope.scopeId !== "");
  const asked = enabled && !isServiceKey && !!organizationId && named.length > 0;
  const query = apiKeyApi.apiKey.grantablePermissions.useQuery(
    {
      organizationId,
      scopes: named,
      ...(ownerUserId ? { ownerUserId } : {}),
    },
    { enabled: asked },
  );
  const all = useMemo(() => categorizablePermissions(), []);

  if (isServiceKey) return { permissions: all, isLoading: false, isError: false, refetch: noop };

  return {
    permissions: asked ? (query.data ?? []) : [],
    isLoading: asked && query.isLoading,
    isError: asked && query.isError,
    refetch: query.refetch,
  };
}

function noop(): void {}
