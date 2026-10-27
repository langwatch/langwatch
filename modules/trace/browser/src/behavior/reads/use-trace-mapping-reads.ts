import type { RouterFromMap, UseTRPCQueryResult } from "@langwatch/api/web";
import type { TRPCClientErrorLike } from "@trpc/client";

import { api, type RouterOutputs, type TraceApiMap } from "../trace-api.ts";
import { useFilterParams } from "../use-filter-params.ts";

/** A `traces` read as its hook hands it back; naming it keeps the emitted declaration small. */
type TracesQuery<Name extends keyof RouterOutputs["traces"]> = UseTRPCQueryResult<
  RouterOutputs["traces"][Name],
  TRPCClientErrorLike<RouterFromMap<TraceApiMap>>
>;

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
}): TracesQuery<"getTracesWithSpansByThreadIds"> {
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
}): TracesQuery<"getTracesWithSpans"> {
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
}): TracesQuery<"getFormattedSpansDigest"> {
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
}): TracesQuery<"getById"> {
  return api.traces.getById.useQuery(
    { projectId: projectId ?? "", traceId },
    { enabled: !!projectId && !!traceId },
  );
}

export function useSampleTraces(): TracesQuery<"getSampleTracesDataset"> {
  const { filterParams, queryOpts } = useFilterParams();
  return api.traces.getSampleTracesDataset.useQuery(filterParams, queryOpts);
}
