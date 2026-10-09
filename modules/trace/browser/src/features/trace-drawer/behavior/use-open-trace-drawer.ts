import { useDrawer } from "@langwatch/browser-host/drawer";
import { type QueryClient, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { useDrawerChrome } from "../../../behavior/drawer-chrome.store.ts";
import {
  buildPreviewTraceDetail,
  buildRichArrivalTraceDetail,
  RICH_ARRIVAL_TRACE_ID,
} from "../../../behavior/explorer/onboarding/data/sample-preview-traces.ts";
import type { TraceListItem } from "../../../behavior/explorer/types/trace.ts";
import { api } from "../../../behavior/trace-api.ts";
import { useOrganizationTeamProject } from "../../../behavior/use-organization-team-project.ts";
import { isPreviewTraceId } from "../../../model/preview-trace-id.ts";
import {
  memberTenantOf,
  TRACE_DRAWER_NAME,
  traceDrawerParams,
} from "../../../model/trace-drawer-params.ts";
import { spanTreeQueryFn, spanTreeQueryKey } from "../../span/behavior/span-tree-paged-query.ts";

/**
 * Open the trace drawer. The header paints at once from the list row as placeholder data
 * (`useTraceListRowHeader`) while the real reads are prefetched in parallel.
 */
export function useOpenTraceDrawer() {
  const { openDrawer } = useDrawer();
  const { project } = useOrganizationTeamProject();
  const utils = api.useUtils();
  const queryClient = useQueryClient();

  return useCallback(
    (trace: TraceListItem) => {
      // On an aggregate the row names its member, and every drawer read stays on it
      // (ADR-177 block F).
      const tenantId = memberTenantOf({ ownerProjectId: trace.projectId, projectId: project?.id });
      const tenantArg = tenantId !== null ? { tenantId } : {};
      if (project?.id && isPreviewTraceId(trace.traceId)) {
        seedPreviewTrace({ utils, projectId: project.id, trace, tenantArg });
      }
      // Kick off the heavier per-trace fetches in parallel with the route change so the
      // waterfall + header render against real data by the time the drawer finishes mounting.
      if (project?.id && !isPreviewTraceId(trace.traceId)) {
        prefetchTraceReads({ utils, queryClient, projectId: project.id, trace, tenantArg });
      }
      // The row's span count holds the skeleton to the right height until the tree loads.
      useDrawerChrome
        .getState()
        .expectSpanCount({ traceId: trace.traceId, count: trace.spanCount });
      openDrawer(TRACE_DRAWER_NAME, {
        // `t` is the partition-pruning hint useTraceHeader reads; the member lets a reload
        // reopen the same member's trace.
        ...traceDrawerParams({ traceId: trace.traceId, occurredAtMs: trace.timestamp, tenantId }),
        // Preview-mode traces always open on the waterfall view — it's the most visual
        // tab, the one the onboarding journey teaches, and the only one we want demos /
        // videos / first impressions to land on.
        ...(isPreviewTraceId(trace.traceId) ? { viz: "waterfall" } : {}),
      });
    },
    [openDrawer, project?.id, utils, queryClient],
  );
}

type TraceUtils = ReturnType<typeof api.useUtils>;

type SeedInput = {
  utils: TraceUtils;
  projectId: string;
  trace: TraceListItem;
  /** The row's member on an aggregate, so seeds land in the cache entries the drawer reads. */
  tenantArg: { tenantId?: string };
};

/** A preview trace exists only in the tour's fixtures, so every read the drawer makes is seeded. */
function seedPreviewTrace({ utils, projectId, trace, tenantArg }: SeedInput): void {
  const detail =
    trace.traceId === RICH_ARRIVAL_TRACE_ID
      ? buildRichArrivalTraceDetail()
      : buildPreviewTraceDetail(trace);

  utils.traces.header.setData(
    { projectId: projectId, traceId: trace.traceId, ...tenantArg, full: true },
    detail.header,
  );
  utils.traces.header.setData(
    {
      projectId: projectId,
      traceId: trace.traceId,
      ...tenantArg,
      occurredAtMs: trace.timestamp,
      full: true,
    },
    detail.header,
  );

  utils.traces.spanTree.setData(
    { projectId: projectId, traceId: trace.traceId, ...tenantArg },
    detail.spanTree,
  );
  utils.traces.spanTree.setData(
    {
      projectId: projectId,
      traceId: trace.traceId,
      ...tenantArg,
      occurredAtMs: trace.timestamp,
    },
    detail.spanTree,
  );

  utils.traces.spansFull.setData(
    { projectId: projectId, traceId: trace.traceId, ...tenantArg },
    detail.spansFull,
  );
  utils.traces.spansFull.setData(
    {
      projectId: projectId,
      traceId: trace.traceId,
      ...tenantArg,
      occurredAtMs: trace.timestamp,
    },
    detail.spansFull,
  );

  for (const span of detail.spanDetails) {
    utils.traces.spanDetail.setData(
      {
        projectId: projectId,
        traceId: trace.traceId,
        ...tenantArg,
        spanId: span.spanId,
      },
      span,
    );
    utils.traces.spanDetail.setData(
      {
        projectId: projectId,
        traceId: trace.traceId,
        ...tenantArg,
        spanId: span.spanId,
        occurredAtMs: trace.timestamp,
      },
      span,
    );
  }

  // No LangWatch-instrumentation signals on the synthetic spans —
  // seed an empty array so the badges UI doesn't spin while the
  // disabled query "loads".
  utils.traces.spanLangwatchSignals.setData(
    { projectId: projectId, traceId: trace.traceId, ...tenantArg },
    [],
  );
  utils.traces.spanLangwatchSignals.setData(
    {
      projectId: projectId,
      traceId: trace.traceId,
      ...tenantArg,
      occurredAtMs: trace.timestamp,
    },
    [],
  );

  utils.traces.traceEvents.setData(
    { projectId: projectId, traceId: trace.traceId, ...tenantArg },
    [],
  );
  utils.traces.traceEvents.setData(
    {
      projectId: projectId,
      traceId: trace.traceId,
      ...tenantArg,
      occurredAtMs: trace.timestamp,
    },
    [],
  );

  utils.traces.evals.setData(
    { projectId: projectId, traceId: trace.traceId, ...tenantArg },
    detail.evaluations,
  );

  if (trace.conversationId) {
    utils.traces.conversationContext.setData(
      {
        projectId: projectId,
        conversationId: trace.conversationId,
        ...tenantArg,
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
  tenantArg,
}: SeedInput & { queryClient: QueryClient }): void {
  const input = {
    projectId: projectId,
    traceId: trace.traceId,
    ...tenantArg,
    occurredAtMs: trace.timestamp,
  };
  // The row placeholder paints the header instantly, but the list row carries no attribute
  // map, so everything the header reads from attributes stays blank until this resolves.
  void utils.traces.header.prefetch({ ...input, full: true }, { staleTime: 0 });
  // Same key + queryFn as `useSpanTree`, so the drawer's mount joins
  // this in-flight paged fetch instead of firing a second one.
  void queryClient.prefetchQuery({
    queryKey: spanTreeQueryKey(input),
    queryFn: spanTreeQueryFn({ utils, queryClient, input }),
  });
  void utils.traces.spanLangwatchSignals.prefetch(input);
  void utils.traces.traceEvents.prefetch(input);
  void utils.traces.resourceInfo.prefetch(input);
}
