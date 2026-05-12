import { useCallback } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";
import { api } from "~/utils/api";
import {
  buildRichArrivalTraceDetail,
  isPreviewTraceId,
  RICH_ARRIVAL_TRACE_ID,
} from "../onboarding/data/samplePreviewTraces";
import { useDrawerStore } from "../stores/drawerStore";
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
    traceName: item.traceName ?? "",
    rootSpanType: item.rootSpanType ?? null,
    scenarioRunId: null,
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
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
        // Seed both keyed-with-timestamp and keyed-without — the drawer
        // hook always sends `occurredAtMs` when present in the URL, but
        // other entry points (back-stack, conversation jumps) don't, so
        // we keep the bare key seeded as a fallback.
        const seed = (prev?: TraceHeader) => prev ?? listItemToHeader(trace);
        utils.tracesV2.header.setData(
          { projectId: project.id, traceId: trace.traceId },
          seed,
        );
        utils.tracesV2.header.setData(
          {
            projectId: project.id,
            traceId: trace.traceId,
            occurredAtMs: trace.timestamp,
          },
          seed,
        );

        // Preview-mode rich seeding. When the user clicks the synthetic
        // "juicy one" arrival trace from the empty-state table, there's
        // nothing in ClickHouse to fetch — but we still want every drawer
        // tab to render with realistic content. Seed the spans, eval
        // results, and conversation context caches so the waterfall, span
        // list, sequence, topology, conversation, and evaluations tabs
        // hydrate from local fixtures the moment the drawer opens.
        if (trace.traceId === RICH_ARRIVAL_TRACE_ID) {
          const detail = buildRichArrivalTraceDetail();

          utils.tracesV2.header.setData(
            { projectId: project.id, traceId: trace.traceId },
            detail.header,
          );
          utils.tracesV2.header.setData(
            {
              projectId: project.id,
              traceId: trace.traceId,
              occurredAtMs: trace.timestamp,
            },
            detail.header,
          );

          utils.tracesV2.spanTree.setData(
            { projectId: project.id, traceId: trace.traceId },
            detail.spanTree,
          );
          utils.tracesV2.spanTree.setData(
            {
              projectId: project.id,
              traceId: trace.traceId,
              occurredAtMs: trace.timestamp,
            },
            detail.spanTree,
          );

          utils.tracesV2.spansFull.setData(
            { projectId: project.id, traceId: trace.traceId },
            detail.spansFull,
          );
          utils.tracesV2.spansFull.setData(
            {
              projectId: project.id,
              traceId: trace.traceId,
              occurredAtMs: trace.timestamp,
            },
            detail.spansFull,
          );

          for (const span of detail.spanDetails) {
            utils.tracesV2.spanDetail.setData(
              {
                projectId: project.id,
                traceId: trace.traceId,
                spanId: span.spanId,
              },
              span,
            );
            utils.tracesV2.spanDetail.setData(
              {
                projectId: project.id,
                traceId: trace.traceId,
                spanId: span.spanId,
                occurredAtMs: trace.timestamp,
              },
              span,
            );
          }

          // No LangWatch-instrumentation signals on the synthetic spans —
          // seed an empty array so the badges UI doesn't spin while the
          // disabled query "loads".
          utils.tracesV2.spanLangwatchSignals.setData(
            { projectId: project.id, traceId: trace.traceId },
            [],
          );
          utils.tracesV2.spanLangwatchSignals.setData(
            {
              projectId: project.id,
              traceId: trace.traceId,
              occurredAtMs: trace.timestamp,
            },
            [],
          );

          utils.tracesV2.events.setData(
            { projectId: project.id, traceId: trace.traceId },
            [],
          );
          utils.tracesV2.events.setData(
            {
              projectId: project.id,
              traceId: trace.traceId,
              occurredAtMs: trace.timestamp,
            },
            [],
          );

          utils.tracesV2.evals.setData(
            { projectId: project.id, traceId: trace.traceId },
            detail.evaluations,
          );

          if (trace.conversationId) {
            utils.tracesV2.conversationContext.setData(
              {
                projectId: project.id,
                conversationId: trace.conversationId,
              },
              detail.conversation,
            );
          }
        }
      }
      // Push into the store before route change so drawer hooks render
      // with the right traceId/occurredAtMs on the very next frame.
      useDrawerStore.getState().openTrace(trace.traceId, trace.timestamp);
      // Preview-mode traces always open on the waterfall view —
      // it's the most visual tab, the one the onboarding journey
      // teaches, and the only one we want demos / videos / first
      // impressions to land on.
      if (isPreviewTraceId(trace.traceId)) {
        useDrawerStore.getState().setVizTab("waterfall");
      }
      openDrawer("traceV2Details", {
        traceId: trace.traceId,
        // `t` (timestamp) is read by useTraceHeader as a partition-pruning
        // hint when refetching the heavy summary fields.
        t: String(trace.timestamp),
      });
    },
    [openDrawer, project?.id, utils],
  );
}
