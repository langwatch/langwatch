import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { isPreviewTraceId } from "../onboarding/data/samplePreviewTraces";

/**
 * Span tree for a specific trace. Used by table-row peek expansions and
 * other surfaces that need just the timing skeleton (no detail payloads).
 *
 * Distinct from `useSpansFull` (which pulls full attributes for the active
 * drawer trace via the drawer store) because peek consumers know the
 * traceId from a row prop, not from the open drawer.
 *
 * `occurredAtMs` (the row's trace timestamp) is forwarded as a partition hint
 * so the `stored_spans` read prunes to the trace's weekly partitions instead
 * of cold-scanning every partition (incl. S3). It is optional; callers that
 * don't have it fall back to the unconstrained scan.
 */
export function useTraceSpanTree(traceId: string, occurredAtMs?: number) {
  const { project } = useOrganizationTeamProject();
  return api.tracesV2.spanTree.useQuery(
    { projectId: project?.id ?? "", traceId, occurredAtMs },
    {
      enabled: !!project?.id && !!traceId && !isPreviewTraceId(traceId),
      staleTime: 300_000,
    },
  );
}
