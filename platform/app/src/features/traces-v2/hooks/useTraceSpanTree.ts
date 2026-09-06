import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { isPreviewTraceId } from "../onboarding/data/samplePreviewTraces";
import { spanTreeQueryFn, spanTreeQueryKey } from "./spanTreePagedQuery";

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
 *
 * Fetches page by page via `spanTreePaginated` into the shared `spanTree`
 * cache key — see `spanTreePagedQuery.ts`.
 */
export function useTraceSpanTree(traceId: string, occurredAtMs?: number) {
  const { project } = useOrganizationTeamProject();
  const utils = api.useUtils();
  const queryClient = useQueryClient();
  const input = { projectId: project?.id ?? "", traceId, occurredAtMs };

  return useQuery({
    queryKey: spanTreeQueryKey(input),
    queryFn: spanTreeQueryFn({ utils, queryClient, input }),
    enabled: !!project?.id && !!traceId && !isPreviewTraceId(traceId),
    staleTime: 300_000,
  });
}
