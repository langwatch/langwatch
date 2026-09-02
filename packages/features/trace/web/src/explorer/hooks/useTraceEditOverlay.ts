import { keepPreviousData } from "@tanstack/react-query";
import type { TraceEditOverlayPatch } from "@langwatch/trace-contract";
import { api } from "../../behavior/trace-api";
import { useSharedTrace } from "../context/SharedTraceContext";
import { useDrawerStore, useTraceEditStore } from "../../index";
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
      gcTime: 1_800_000,
      placeholderData: keepPreviousData,
    },
  );

  // Guard against `placeholderData: keepPreviousData`: on a trace switch the previous trace's
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
