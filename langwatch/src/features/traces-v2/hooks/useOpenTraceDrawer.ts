import { useCallback } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { TraceHeader } from "~/server/api/routers/tracesV2.schemas";
import { api } from "~/utils/api";
import {
  buildPreviewTraceDetail,
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

        // Preview-mode seeding. Every sample-preview trace lives entirely
        // client-side — ClickHouse has nothing — and the drawer's data
        // hooks (header, spanTree, spansFull, spanDetail, signals,
        // events, evals, conversationContext) are all gated off for
        // preview ids. Without seeding, opening the drawer leaves every
        // tab spinning forever. Two builders: the rich-arrival trace
        // gets its hand-built showpiece detail (multi-span waterfall,
        // full eval set, multi-turn conversation), every other sample
        // trace gets a synthesised single-root-span detail derived from
        // the TraceListItem itself. Both share the same seeding code
        // path below so we can't accidentally seed one cache but skip
        // another.
        if (isPreviewTraceId(trace.traceId)) {
          const detail =
            trace.traceId === RICH_ARRIVAL_TRACE_ID
              ? buildRichArrivalTraceDetail()
              : buildPreviewTraceDetail(trace);

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

          utils.tracesV2.traceEvents.setData(
            { projectId: project.id, traceId: trace.traceId },
            [],
          );
          utils.tracesV2.traceEvents.setData(
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
      // Kick off the heavier per-trace fetches in parallel with the
      // route change so the waterfall + header render against real data
      // by the time the drawer has finished mounting — operator feedback
      // was that the trace tab sat on the loading skeleton for ~half a
      // second even though we already had the row data. Prefetch is a
      // no-op when the query is already cached, and tRPC dedupes the
      // matching React Query subscription that the drawer mounts.
      if (project?.id && !isPreviewTraceId(trace.traceId)) {
        const input = {
          projectId: project.id,
          traceId: trace.traceId,
          occurredAtMs: trace.timestamp,
        };
        const opts = { staleTime: 300_000 };
        // The row seed above paints the header instantly, but the list row
        // carries no attribute map (`attributes: {}`), so everything the
        // header reads from attributes — cache-read / cache-write + reasoning
        // token sums and the reasoning-effort setting — stays blank. `setData`
        // marks that seed fresh for the 5-min staleTime, so without forcing a
        // fetch the cache tokens never appear until a hard refresh. staleTime:0
        // pulls the full header (with attributes) immediately, behind the seed.
        void utils.tracesV2.header.prefetch(input, { staleTime: 0 });
        void utils.tracesV2.spanTree.prefetch(input, opts);
        void utils.tracesV2.spanLangwatchSignals.prefetch(input, opts);
        void utils.tracesV2.traceEvents.prefetch(input, opts);
        void utils.tracesV2.resourceInfo.prefetch(input, opts);
      }
      // Push into the store before route change so drawer hooks render
      // with the right traceId/occurredAtMs on the very next frame.
      // Pass the row's spanCount through so the drawer skeleton can
      // size its accordion / span list section before the spanTree
      // query resolves — eliminates the noticeable reflow that
      // happened once the real data landed.
      useDrawerStore
        .getState()
        .openTrace(trace.traceId, trace.timestamp, trace.spanCount);
      // Preview-mode traces always open on the waterfall view —
      // it's the most visual tab, the one the onboarding journey
      // teaches, and the only one we want demos / videos / first
      // impressions to land on. Use the transient setter so this
      // programmatic override does NOT clobber the operator's
      // persisted preference for normal traces.
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
    [openDrawer, project?.id, utils],
  );
}
