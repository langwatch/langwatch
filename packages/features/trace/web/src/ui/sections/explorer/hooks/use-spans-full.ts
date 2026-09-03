import { keepPreviousData } from "@tanstack/react-query";
import { useMemo } from "react";
import type { SpanDetail } from "@langwatch/trace-contract";
import {
  expandDeletedSpanIds,
  indexSpanPatches,
} from "@langwatch/trace-contract";
import { applyOverlayToSpanDetail } from "../../../../model/traces/edit-overlay/apply-trace-edit-overlay-to-views";
import type { TraceEditOverlayPatch } from "@langwatch/trace-contract";
import { api } from "../../trace-api";
import { asSharedQueryResult, useSharedTrace } from "../context/shared-trace-context";
import { useAppliedTraceEditPatch } from "./use-trace-edit-overlay";
import { useTraceQueryArgs } from "./use-trace-query-args";

/** Every span's detail exactly as captured, before any correction. */
export function useSpansFullCanonical(enabled: boolean) {
  const shared = useSharedTrace();
  const { isReady, queryArgs } = useTraceQueryArgs();

  const query = api.tracesV2.spansFull.useQuery(queryArgs, {
    enabled: enabled && isReady && !shared,
    staleTime: 300_000,
    // Hold the span tree in cache for 30 min after the last observer
    // unmounts. Lets users flip between recently-viewed traces in the
    // conversation strip with no loading flash.
    gcTime: 1_800_000,
    // While the new trace's spans are loading, keep showing the previous
    // trace's spans rather than a skeleton. The visualizer panel pops
    // back instantly when navigating between siblings.
    placeholderData: keepPreviousData,
  });

  if (shared) return asSharedQueryResult(shared.spansFull) as unknown as typeof query;
  return query;
}

/**
 * Applies a correction to a whole page of span details: deleted spans (and
 * their descendants) drop out, corrected fields land. Returns the same array
 * when nothing changed so consumers can compare references.
 */
export function applyOverlayToSpansFull({
  spans,
  patch,
}: {
  spans: SpanDetail[];
  patch: TraceEditOverlayPatch | null | undefined;
}): SpanDetail[] {
  if (!patch) return spans;

  const deleted = expandDeletedSpanIds({
    links: spans.map((span) => ({
      id: span.spanId,
      parentId: span.parentSpanId,
    })),
    deletedSpanIds: patch.deletedSpanIds,
  });

  // Built once for the whole page: the per-span call would otherwise rebuild it
  // every time, and a large corrected trace would block the UI walking it.
  const spanPatches = indexSpanPatches(patch);

  let changed = false;
  const next: SpanDetail[] = [];
  for (const span of spans) {
    if (deleted.has(span.spanId)) {
      changed = true;
      continue;
    }
    const corrected = applyOverlayToSpanDetail({
      detail: span,
      patch,
      spanPatches,
    });
    if (corrected !== span) changed = true;
    next.push(corrected);
  }
  return changed ? next : spans;
}

/**
 * Every span's detail as the reader sees it: corrected when a correction
 * applies, captured otherwise.
 */
export function useSpansFull(enabled: boolean) {
  const query = useSpansFullCanonical(enabled);
  const patch = useAppliedTraceEditPatch();
  const spans = query.data;

  const data = useMemo(
    () => (spans ? applyOverlayToSpansFull({ spans, patch }) : spans),
    [spans, patch],
  );

  return useMemo(
    () => (data === spans ? query : { ...query, data }),
    [query, data, spans],
  );
}
