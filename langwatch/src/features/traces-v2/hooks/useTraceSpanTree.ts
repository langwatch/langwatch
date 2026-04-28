import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * Span tree for a specific trace. Used by table-row peek expansions and
 * other surfaces that need just the timing skeleton (no detail payloads).
 *
 * Distinct from `useSpansFull` (which pulls full attributes for the active
 * drawer trace via the drawer store) because peek consumers know the
 * traceId from a row prop, not from the open drawer.
 */
export function useTraceSpanTree(traceId: string) {
  const { project } = useOrganizationTeamProject();
  return api.tracesV2.spanTree.useQuery(
    { projectId: project?.id ?? "", traceId },
    { enabled: !!project?.id && !!traceId, staleTime: 300_000 },
  );
}
