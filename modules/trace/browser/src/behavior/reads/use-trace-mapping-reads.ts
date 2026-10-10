import { api } from "../trace-api.ts";
import { useFilterParams } from "../use-filter-params.ts";

export function useTracesWithSpansByThreadIds({
  projectId,
  threadIds,
  withEditOverlay,
  enabled = true,
}: {
  projectId: string | undefined;
  threadIds: string[];
  withEditOverlay: boolean;
  enabled?: boolean;
}) {
  return api.traces.getTracesWithSpansByThreadIds.useQuery(
    { projectId: projectId ?? "", threadIds, withEditOverlay },
    { enabled: !!projectId && threadIds.length > 0 && enabled },
  );
}

export function useTracesWithSpans({
  projectId,
  traceIds,
  withEditOverlay,
}: {
  projectId: string | undefined;
  traceIds: string[];
  withEditOverlay: boolean;
}) {
  return api.traces.getTracesWithSpans.useQuery(
    { projectId: projectId ?? "", traceIds, withEditOverlay },
    { enabled: !!projectId },
  );
}

export function useFormattedSpansDigest({
  projectId,
  traceIds,
  withEditOverlay,
  enabled,
}: {
  projectId: string | undefined;
  traceIds: string[];
  withEditOverlay?: boolean;
  enabled: boolean;
}) {
  return api.traces.getFormattedSpansDigest.useQuery(
    {
      projectId: projectId ?? "",
      traceIds,
      ...(withEditOverlay !== void 0 ? { withEditOverlay } : {}),
    },
    { enabled: !!projectId && traceIds.length > 0 && enabled },
  );
}

export function useTraceById({
  projectId,
  traceId,
}: {
  projectId: string | undefined;
  traceId: string;
}) {
  return api.traces.getById.useQuery(
    { projectId: projectId ?? "", traceId },
    { enabled: !!projectId && !!traceId },
  );
}

export function useSampleTraces() {
  const { filterParams, queryOpts } = useFilterParams();
  return api.traces.getSampleTracesDataset.useQuery(filterParams, queryOpts);
}
