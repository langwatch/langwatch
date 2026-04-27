import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type {
  InstrumentationScope,
  SpanResourceInfoDto,
} from "~/server/api/routers/tracesV2.schemas";

export interface TraceResourcesResult {
  rootSpanId: string | null;
  resourceAttributes: Record<string, string>;
  scope: InstrumentationScope | null;
  spans: SpanResourceInfoDto[];
  /** Map of spanId → span resource info for O(1) per-span lookup. */
  bySpanId: Record<string, SpanResourceInfoDto>;
  isLoading: boolean;
}

const NULL_RESULT: TraceResourcesResult = {
  rootSpanId: null,
  resourceAttributes: {},
  scope: null,
  spans: [],
  bySpanId: {},
  isLoading: false,
};

/**
 * OTel resource attrs + instrumentation scope for the trace and each span.
 * The standard span mapper drops both, so this dedicated read path is the
 * only way to surface them in the drawer.
 */
export function useTraceResources(traceId: string | null | undefined): TraceResourcesResult {
  const { project } = useOrganizationTeamProject();
  const enabled = !!project?.id && !!traceId;

  const query = api.tracesV2.resourceInfo.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId ?? "",
    },
    {
      enabled,
      staleTime: 60_000,
      refetchOnWindowFocus: false,
    },
  );

  return useMemo<TraceResourcesResult>(() => {
    if (!enabled) return NULL_RESULT;
    if (!query.data) return { ...NULL_RESULT, isLoading: query.isLoading };
    const bySpanId: Record<string, SpanResourceInfoDto> = {};
    for (const s of query.data.spans) bySpanId[s.spanId] = s;
    return {
      rootSpanId: query.data.rootSpanId,
      resourceAttributes: query.data.resourceAttributes,
      scope: query.data.scope,
      spans: query.data.spans,
      bySpanId,
      isLoading: false,
    };
  }, [enabled, query.data, query.isLoading]);
}
