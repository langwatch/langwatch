import { dejaViewHref } from "@langwatch/ops-contract";

import { api } from "./scenario-api.ts";

/** The DejaView link for one aggregate, offered only to a reader with ops access. */
export function useDejaViewLink({
  aggregateId,
  tenantId,
}: {
  aggregateId: string | undefined;
  tenantId: string | undefined;
}): { href: string | null } {
  const query = api.ops.getScope.useQuery(undefined, { retry: false });
  const scope = query.data?.scope;
  const hasAccess = !!scope && scope.kind !== "none";

  if (!hasAccess || !aggregateId || !tenantId) return { href: null };
  return { href: dejaViewHref({ aggregateId, tenantId }) };
}
