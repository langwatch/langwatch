import { useCallback } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";
import type { TraceListItem } from "../types/trace";

function listItemToHeader(item: TraceListItem): TraceHeader {
  return {
    traceId: item.traceId,
    timestamp: item.timestamp,
    name: item.name,
    serviceName: item.serviceName,
    origin: item.origin,
    conversationId: item.conversationId ?? null,
    userId: item.userId ?? null,
    durationMs: item.durationMs,
    spanCount: item.spanCount,
    status: item.status,
    error: item.error,
    input: item.input,
    output: item.output,
    models: item.models,
    totalCost: item.totalCost,
    totalTokens: item.totalTokens,
    inputTokens: item.inputTokens ?? null,
    outputTokens: item.outputTokens ?? null,
    tokensEstimated: item.tokensEstimated ?? false,
    ttft: item.ttft,
    rootSpanName: item.rootSpanName ?? null,
    rootSpanType: item.rootSpanType ?? null,
    attributes: {},
    events: (item.events ?? []).map((e) => ({
      spanId: e.spanId,
      timestamp: e.timestamp,
      name: e.name,
      attributes: {},
    })),
  };
}

/**
 * Open the trace drawer with seeded header data so the drawer renders
 * immediately from row data, then refetches in the background to fill in
 * remaining details (attributes, span tree, full evals/events).
 */
export function useOpenTraceDrawer() {
  const { openDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();
  const utils = api.useContext();

  return useCallback(
    (trace: TraceListItem) => {
      if (project?.id) {
        utils.tracesV2.header.setData(
          { projectId: project.id, traceId: trace.traceId },
          (prev) => prev ?? listItemToHeader(trace),
        );
      }
      openDrawer("traceV2Details", { traceId: trace.traceId });
    },
    [openDrawer, project?.id, utils],
  );
}
