import { keepPreviousData } from "@tanstack/react-query";
import type { TraceEditOverlayPatch } from "@langwatch/trace-contract";
import { api } from "../../../../behavior/trace-api";
import { useSharedTrace } from "../context/shared-trace-context";
import { useDrawerStore, useTraceEditStore } from "../../../../index";
import { useTraceQueryArgs } from "./use-trace-query-args";

/**
 * The correction stored for the open trace, or null when there is none.
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
 * The correction to apply to what the reader is looking at, or null to show the trace
 * exactly as captured.
 */
export function useAppliedTraceEditPatch(): TraceEditOverlayPatch | null {
  const overlay = useTraceEditOverlay();
  const overlayView = useTraceEditStore((s) => s.overlayView);
  const isEditing = useDrawerStore((s) => s.isEditing);

  if (isEditing) return null;
  if (overlayView !== "edited") return null;
  return overlay.data?.patch ?? null;
}
