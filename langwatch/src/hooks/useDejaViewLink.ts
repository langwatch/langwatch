import { useOpsPermission } from "./useOpsPermission";

export function useDejaViewLink(params: {
  aggregateId: string | undefined;
  tenantId: string | undefined;
  /** Set false on surfaces rendered for anonymous viewers — skips the ops probe. */
  enabled?: boolean;
}): { href: string | null } {
  const { hasAccess } = useOpsPermission({ enabled: params.enabled ?? true });

  if (!hasAccess || !params.aggregateId || !params.tenantId) {
    return { href: null };
  }

  const fragment = new URLSearchParams();
  fragment.set("a", params.aggregateId);
  fragment.set("at", params.tenantId);

  return { href: `/ops/dejaview#${fragment.toString()}` };
}
