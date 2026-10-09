import { nowInstant } from "@langwatch/time";

import { useDrawerProjectId } from "../../features/trace-drawer/behavior/use-drawer-project-id.ts";
import { isPreviewTraceId } from "../../model/preview-trace-id.ts";
import { LIVE_WINDOW_MS } from "../../model/trace-freshness.ts";
import { useTraceDrawer } from "../trace-drawer.ts";
import { useOrganizationTeamProject } from "../use-organization-team-project.ts";
import { useTraceViewer } from "./context/trace-viewer-context.tsx";

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
