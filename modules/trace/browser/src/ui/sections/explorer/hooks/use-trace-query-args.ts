import { nowInstant } from "@langwatch/time";

import { useTraceDrawer } from "../../../../behavior/trace-drawer.ts";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { isPreviewTraceId } from "../../../../model/preview-trace-id.ts";
import { LIVE_WINDOW_MS } from "../../../../model/trace-freshness.ts";
import { useTraceViewer } from "../../../elements/explorer/context/trace-viewer-context.tsx";
import { useDrawerProjectId } from "./use-drawer-project-id.ts";

/**
 * Shared base wiring for the per-trace tRPC queries fired off the open drawer (header,
 * span tree, signals, detail prefetch, etc.).
 */
export function useTraceQueryArgs() {
  const { project } = useOrganizationTeamProject();
  // The share page injects its trace through context rather than the drawer
  // store, and seeds the cache under these keys, so it never fetches.
  const viewer = useTraceViewer();
  const storeTraceId = useTraceDrawer((s) => s.traceId);
  const traceId = viewer.traceId ?? storeTraceId;
  const occurredAtMs = useTraceDrawer((s) => s.occurredAtMs);
  const projectId = useDrawerProjectId();

  const isLive =
    occurredAtMs !== null && nowInstant().epochMilliseconds - occurredAtMs < LIVE_WINDOW_MS;

  const queryArgs = {
    projectId,
    traceId: traceId ?? "",
    ...(occurredAtMs !== null ? { occurredAtMs } : {}),
  };

  const isReady =
    !!projectId && !!traceId && !isPreviewTraceId(traceId ?? "") && !viewer.isReadOnly;
  // The header read runs without the partition hint and backfills it; every other read waits.
  const hintReady = occurredAtMs !== null;

  return {
    project,
    projectId,
    traceId,
    occurredAtMs,
    isLive,
    isReady,
    hintReady,
    queryArgs,
  };
}
