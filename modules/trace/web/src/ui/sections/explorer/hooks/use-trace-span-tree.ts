import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { api } from "../../../../behavior/trace-api.ts";
import { isPreviewTraceId } from "../../../../model/preview-trace-id.ts";
import { spanTreeQueryFn, spanTreeQueryKey } from "./span-tree-paged-query.ts";

/**
 * Span tree for a specific trace. Used by table-row peek expansions and other surfaces
 * that need just the timing skeleton (no detail payloads).
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
