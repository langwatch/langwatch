import type { TraceEditOverlayPatch } from "~/server/traces/edit-overlay/traceEditOverlay.schemas";
import { api } from "~/utils/api";
import { useSharedTrace } from "../context/SharedTraceContext";
import { useDrawerStore } from "../stores/drawerStore";
import { useTraceEditStore } from "../stores/traceEditStore";
import { useTraceQueryArgs } from "./useTraceQueryArgs";

/**
 * The correction stored for the open trace, or null when there is none.
 *
 * Disabled on the public share surface: a share carries its own payload and no
 * session, and a correction is review work that is not part of what was shared.
 */
export function useTraceEditOverlay() {
  const shared = useSharedTrace();
  const { isReady, queryArgs } = useTraceQueryArgs();

  const query = api.traceEditOverlay.getByTraceId.useQuery(
    { projectId: queryArgs.projectId, traceId: queryArgs.traceId },
    {
      enabled: isReady && !shared,
      staleTime: 300_000,
      cacheTime: 1_800_000,
      keepPreviousData: true,
    },
  );

  // Guard against `keepPreviousData`: on a trace switch the previous trace's
  // correction lingers in `query.data` until the new read lands. Handing it on
  // would apply one trace's correction to another, and adopt it as the editing
  // baseline for a trace it was never written against.
  if (query.data && query.data.traceId !== queryArgs.traceId) {
    return { ...query, data: null };
  }
  return query;
}

/**
 * The correction to apply to what the reader is looking at, or null to show the
 * trace exactly as captured.
 *
 * Three things turn it off: there is no correction; the reader asked for the
 * captured trace; or they are editing, in which case the drawer must show what
 * they are correcting rather than a correction applied on top of itself.
 */
export function useAppliedTraceEditPatch(): TraceEditOverlayPatch | null {
  const overlay = useTraceEditOverlay();
  const overlayView = useTraceEditStore((s) => s.overlayView);
  const isEditing = useDrawerStore((s) => s.isEditing);

  if (isEditing) return null;
  if (overlayView !== "edited") return null;
  return overlay.data?.patch ?? null;
}
