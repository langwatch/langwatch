import { dejaViewHref, opsScopeProbeSchema } from "@langwatch/ops-contract";

import { experimentApi } from "./experiment-api.ts";

/** An operator's scope does not change mid-session, so the probe is not re-asked on every open. */
const OPS_SCOPE_STALE_TIME_MS = 5 * 60_000;

/** The DejaView link for one aggregate, offered only to a reader with ops access. */
export function useDejaViewLink({
  aggregateId,
  tenantId,
}: {
  aggregateId: string | undefined;
  tenantId: string | undefined;
}): { href: string | null } {
  const query = experimentApi.ops.getScope.useQuery(undefined, {
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: OPS_SCOPE_STALE_TIME_MS,
  });
  const probe = opsScopeProbeSchema.safeParse(query.data);
  const hasAccess = probe.success && probe.data.scope.kind !== "none";

  if (!hasAccess || !aggregateId || !tenantId) return { href: null };
  return { href: dejaViewHref({ aggregateId, tenantId }) };
}
