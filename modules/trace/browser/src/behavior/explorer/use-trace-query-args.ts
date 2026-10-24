import { nowInstant } from "@langwatch/time";

import { useDrawerProjectId } from "../../features/trace-drawer/behavior/use-drawer-project-id.ts";
import { isPreviewTraceId } from "../../model/preview-trace-id.ts";
import { LIVE_WINDOW_MS } from "../../model/trace-freshness.ts";
import { useTraceDrawer } from "../trace-drawer.ts";
import { useOrganizationTeamProject } from "../use-organization-team-project.ts";
import { useTraceViewer } from "./context/trace-viewer-context.tsx";

/**
 * The time a read may send: the link's own, never one the header filled in later. Held in the
 * drawer, not per component, so a panel mounted after the fill reads the same keys.
 */
function readableOccurredAtMs({
  traceId,
  occurredAtMs,
  backfilled,
}: {
  traceId: string | null;
  occurredAtMs: number | null;
  backfilled: { traceId: string; occurredAtMs: number } | null;
}): number | null {
  const isBackfilled =
    backfilled !== null &&
    backfilled.traceId === traceId &&
    backfilled.occurredAtMs === occurredAtMs;
  return isBackfilled ? null : occurredAtMs;
}

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
  const addressedTenantId = useTraceDrawer((s) => s.tenantId);
  // The owning member on an aggregate only: a plain project's own id would split its cache.
  const tenantId =
    addressedTenantId !== null && addressedTenantId !== projectId ? addressedTenantId : null;

  const backfilled = useTraceDrawer((s) => s.backfilledOccurredAt);
  const readOccurredAtMs = readableOccurredAtMs({ traceId, occurredAtMs, backfilled });

  const isLive =
    occurredAtMs !== null && nowInstant().epochMilliseconds - occurredAtMs < LIVE_WINDOW_MS;

  const queryArgs = {
    projectId,
    traceId: traceId ?? "",
    ...(readOccurredAtMs !== null ? { occurredAtMs: readOccurredAtMs } : {}),
    ...(tenantId !== null ? { tenantId } : {}),
  };

  const isReady =
    !!projectId && !!traceId && !isPreviewTraceId(traceId ?? "") && !viewer.isReadOnly;

  return {
    project,
    projectId,
    traceId,
    occurredAtMs,
    tenantId,
    isLive,
    isReady,
    queryArgs,
  };
}
