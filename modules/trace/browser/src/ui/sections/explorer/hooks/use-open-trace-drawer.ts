import type { TraceHeader } from "@langwatch/trace-contract";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useDrawerStore } from "../../../../behavior/drawer.store.ts";
import { api } from "../../../../behavior/trace-api.ts";
import { useDrawer } from "../../../../behavior/use-drawer.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { isPreviewTraceId } from "../../../../model/preview-trace-id.ts";
import {
  buildPreviewTraceDetail,
  buildRichArrivalTraceDetail,
  RICH_ARRIVAL_TRACE_ID,
} from "../onboarding/data/sample-preview-traces.ts";
import type { TraceListItem } from "../types/trace.ts";
import { spanTreeQueryFn, spanTreeQueryKey } from "./span-tree-paged-query.ts";

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
    nonBilledCost: item.nonBilledCost,
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
  const utils = api.useUtils();
  const queryClient = useQueryClient();

  return useCallback(
    (trace: TraceListItem) => {
      if (project?.id) {
        seedRowHeader({ utils, projectId: project.id, trace });
        if (isPreviewTraceId(trace.traceId)) {
          seedPreviewTrace({ utils, projectId: project.id, trace });
        }
      }
      // Kick off the heavier per-trace fetches in parallel with the route change so the
      // waterfall + header render against real data by the time the drawer finishes mounting.
      if (project?.id && !isPreviewTraceId(trace.traceId)) {
        prefetchTraceReads({ utils, queryClient, projectId: project.id, trace });
      }
      // Push into the store before route change so drawer hooks render with the right
      // traceId/occurredAtMs on the very next frame.
      useDrawerStore.getState().openTrace(trace.traceId, trace.timestamp, {
        expectedSpanCount: trace.spanCount,
      });
      // Preview-mode traces always open on the waterfall view — it's the most visual
      // tab, the one the onboarding journey teaches, and the only one we want demos /
      // videos / first impressions to land on.
      if (isPreviewTraceId(trace.traceId)) {
        useDrawerStore.getState().setVizTabTransient("waterfall");
      }
      openDrawer("traceV2Details", {
        traceId: trace.traceId,
        // `t` (timestamp) is read by useTraceHeader as a partition-pruning
        // hint when refetching the heavy summary fields.
        t: String(trace.timestamp),
      });
    },
    [openDrawer, project?.id, utils, queryClient],
  );
}

type TraceUtils = ReturnType<typeof api.useUtils>;

type SeedInput = { utils: TraceUtils; projectId: string; trace: TraceListItem };

function seedRowHeader({ utils, projectId, trace }: SeedInput): void {
  // Seed both keyed-with-timestamp and keyed-without: some entry points don't send
  // `occurredAtMs`. `full: true` matches useTraceHeader's own query key, so the seed must
  // land under the same key or the drawer's mount sees a cache miss and reloads anyway.
  const seed = (prev?: TraceHeader) => prev ?? listItemToHeader(trace);
  utils.traces.header.setData({ projectId: projectId, traceId: trace.traceId, full: true }, seed);
  utils.traces.header.setData(
    {
      projectId: projectId,
      traceId: trace.traceId,
      occurredAtMs: trace.timestamp,
      full: true,
    },
    seed,
  );
}

/** A preview trace exists only in the tour's fixtures, so every read the drawer makes is seeded. */
function seedPreviewTrace({ utils, projectId, trace }: SeedInput): void {
  const detail =
    trace.traceId === RICH_ARRIVAL_TRACE_ID
      ? buildRichArrivalTraceDetail()
      : buildPreviewTraceDetail(trace);

  utils.traces.header.setData(
    { projectId: projectId, traceId: trace.traceId, full: true },
    detail.header,
  );
  utils.traces.header.setData(
    {
      projectId: projectId,
      traceId: trace.traceId,
      occurredAtMs: trace.timestamp,
      full: true,
    },
    detail.header,
  );

  utils.traces.spanTree.setData({ projectId: projectId, traceId: trace.traceId }, detail.spanTree);
  utils.traces.spanTree.setData(
    {
      projectId: projectId,
      traceId: trace.traceId,
      occurredAtMs: trace.timestamp,
    },
    detail.spanTree,
  );

  utils.traces.spansFull.setData(
    { projectId: projectId, traceId: trace.traceId },
    detail.spansFull,
  );
  utils.traces.spansFull.setData(
    {
      projectId: projectId,
      traceId: trace.traceId,
      occurredAtMs: trace.timestamp,
    },
    detail.spansFull,
  );

  for (const span of detail.spanDetails) {
    utils.traces.spanDetail.setData(
      {
        projectId: projectId,
        traceId: trace.traceId,
        spanId: span.spanId,
      },
      span,
    );
    utils.traces.spanDetail.setData(
      {
        projectId: projectId,
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
  utils.traces.spanLangwatchSignals.setData({ projectId: projectId, traceId: trace.traceId }, []);
  utils.traces.spanLangwatchSignals.setData(
    {
      projectId: projectId,
      traceId: trace.traceId,
      occurredAtMs: trace.timestamp,
    },
    [],
  );

  utils.traces.traceEvents.setData({ projectId: projectId, traceId: trace.traceId }, []);
  utils.traces.traceEvents.setData(
    {
      projectId: projectId,
      traceId: trace.traceId,
      occurredAtMs: trace.timestamp,
    },
    [],
  );

  utils.traces.evals.setData({ projectId: projectId, traceId: trace.traceId }, detail.evaluations);

  if (trace.conversationId) {
    utils.traces.conversationContext.setData(
      {
        projectId: projectId,
        conversationId: trace.conversationId,
      },
      detail.conversation,
    );
  }
}

function prefetchTraceReads({
  utils,
  queryClient,
  projectId,
  trace,
}: SeedInput & { queryClient: QueryClient }): void {
  const input = {
    projectId: projectId,
    traceId: trace.traceId,
    occurredAtMs: trace.timestamp,
  };
  const opts = { staleTime: 300_000 };
  // The row seed above paints the header instantly, but the list row carries no attribute
  // map, so everything the header reads from attributes stays blank until this resolves.
  void utils.traces.header.prefetch({ ...input, full: true }, { staleTime: 0 });
  // Same key + queryFn as `useSpanTree`, so the drawer's mount joins
  // this in-flight paged fetch instead of firing a second one.
  void queryClient.prefetchQuery({
    queryKey: spanTreeQueryKey(input),
    queryFn: spanTreeQueryFn({ utils, queryClient, input }),
    ...opts,
  });
  void utils.traces.spanLangwatchSignals.prefetch(input, opts);
  void utils.traces.traceEvents.prefetch(input, opts);
  void utils.traces.resourceInfo.prefetch(input, opts);
}
