import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project.ts";
import { useDrawerStore } from "../../../../behavior/drawer.store.ts";
import { isPreviewTraceId } from "../../../../model/preview-trace-id.ts";
import { LIVE_WINDOW_MS } from "../../../../model/trace-freshness.ts";
import { useTraceViewer } from "../../../elements/explorer/context/trace-viewer-context.tsx";
import { useDrawerProjectId } from "./use-drawer-project-id.ts";
import { nowInstant } from "@langwatch/time";

/**
 * Shared base wiring for the per-trace tRPC queries fired off the open drawer (header,
 * span tree, signals, detail prefetch, etc.).
 */
export function useTraceQueryArgs() {
  const { project } = useOrganizationTeamProject();
  // The share page injects its trace through context rather than the drawer
  // store, so the global drawer mount stays inert. See TraceViewerContext.
  const viewer = useTraceViewer();
  const storeTraceId = useDrawerStore((s) => s.traceId);
  const traceId = viewer.traceId ?? storeTraceId;
  const occurredAtMs = useDrawerStore((s) => s.occurredAtMs);
  const projectId = useDrawerProjectId();

  const isLive =
    occurredAtMs !== null && nowInstant().epochMilliseconds - occurredAtMs < LIVE_WINDOW_MS;

  const queryArgs = {
    projectId,
    traceId: traceId ?? "",
    ...(occurredAtMs !== null ? { occurredAtMs } : {}),
  };

  const isReady = !!projectId && !!traceId && !isPreviewTraceId(traceId ?? "");

  return {
    project,
    projectId,
    traceId,
    occurredAtMs,
    isLive,
    isReady,
    queryArgs,
  };
}
