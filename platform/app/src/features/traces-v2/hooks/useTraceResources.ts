import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type {
  InstrumentationScope,
  SpanResourceInfoDto,
} from "~/server/api/routers/tracesV2.schemas";
import { api } from "~/utils/api";
import { useSharedTrace } from "../context/SharedTraceContext";
import { useDrawerStore } from "../stores/drawerStore";

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
export function useTraceResources(
  traceId: string | null | undefined,
): TraceResourcesResult {
  const { project } = useOrganizationTeamProject();
  const shared = useSharedTrace();
  const occurredAtMs = useDrawerStore((s) => s.occurredAtMs);
  const enabled = !!project?.id && !!traceId && !shared;

  const query = api.tracesV2.resourceInfo.useQuery(
    {
      projectId: project?.id ?? "",
      traceId: traceId ?? "",
      ...(occurredAtMs !== null ? { occurredAtMs } : {}),
    },
    {
      enabled,
      staleTime: 60_000,
      cacheTime: 1_800_000,
      refetchOnWindowFocus: false,
    },
  );

  const data = shared?.resources ?? query.data;

  return useMemo<TraceResourcesResult>(() => {
    if (!data) {
      if (!enabled) return NULL_RESULT;
      return { ...NULL_RESULT, isLoading: query.isLoading };
    }
    const bySpanId: Record<string, SpanResourceInfoDto> = {};
    for (const s of data.spans) bySpanId[s.spanId] = s;
    return {
      rootSpanId: data.rootSpanId,
      resourceAttributes: data.resourceAttributes,
      scope: data.scope,
      spans: data.spans,
      bySpanId,
      isLoading: false,
    };
  }, [enabled, data, query.isLoading]);
}
