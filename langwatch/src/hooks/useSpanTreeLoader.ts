import { useCallback, useEffect, useReducer, useRef } from "react";
import { api } from "~/utils/api";
import type { Span } from "~/server/tracer/types";

const PAGE_SIZE = 200;
const BACKFILL_DELAY_MS = 200;

type Phase = "loading" | "backfilling" | "live";

interface SpanTreeState {
  spans: Map<string, Span>;
  newSpanIds: Set<string>;
  total: number;
  phase: Phase;
  highWaterMark: number;
  nextOffset: number;
}

type SpanTreeAction =
  | { type: "INITIAL_LOAD"; spans: Span[]; total: number }
  | { type: "BATCH_LOADED"; spans: Span[] }
  | { type: "DELTA_RECEIVED"; spans: Span[] }
  | { type: "CLEAR_NEW_FLAGS" }
  | { type: "SET_TOTAL"; total: number };

function spanTreeReducer(state: SpanTreeState, action: SpanTreeAction): SpanTreeState {
  switch (action.type) {
    case "INITIAL_LOAD": {
      const spans = new Map<string, Span>();
      let highWaterMark = 0;
      for (const span of action.spans) {
        spans.set(span.span_id, span);
        const startTime = span.timestamps?.started_at ?? 0;
        if (startTime > highWaterMark) highWaterMark = startTime;
      }
      const nextOffset = action.spans.length;
      const phase = nextOffset >= action.total ? "live" : "backfilling";
      return {
        spans,
        newSpanIds: new Set(),
        total: action.total,
        phase,
        highWaterMark,
        nextOffset,
      };
    }
    case "BATCH_LOADED": {
      const spans = new Map(state.spans);
      let highWaterMark = state.highWaterMark;
      for (const span of action.spans) {
        spans.set(span.span_id, span);
        const startTime = span.timestamps?.started_at ?? 0;
        if (startTime > highWaterMark) highWaterMark = startTime;
      }
      const nextOffset = state.nextOffset + action.spans.length;
      const phase = nextOffset >= state.total ? "live" : "backfilling";
      return { ...state, spans, highWaterMark, nextOffset, phase };
    }
    case "DELTA_RECEIVED": {
      if (action.spans.length === 0) return state;
      const spans = new Map(state.spans);
      const newSpanIds = new Set(state.newSpanIds);
      let highWaterMark = state.highWaterMark;
      let total = state.total;
      for (const span of action.spans) {
        if (!spans.has(span.span_id)) {
          newSpanIds.add(span.span_id);
          total++;
        }
        spans.set(span.span_id, span);
        const startTime = span.timestamps?.started_at ?? 0;
        if (startTime > highWaterMark) highWaterMark = startTime;
      }
      return { ...state, spans, newSpanIds, highWaterMark, total };
    }
    case "CLEAR_NEW_FLAGS":
      if (state.newSpanIds.size === 0) return state;
      return { ...state, newSpanIds: new Set() };
    case "SET_TOTAL":
      return { ...state, total: action.total };
  }
}

const INITIAL_STATE: SpanTreeState = {
  spans: new Map(),
  newSpanIds: new Set(),
  total: 0,
  phase: "loading",
  highWaterMark: 0,
  nextOffset: 0,
};

export function useSpanTreeLoader({
  projectId,
  traceId,
  occurredAtMs,
  enabled = true,
}: {
  projectId: string;
  traceId: string;
  /**
   * Approximate trace timestamp (ms since epoch). Threaded into the span reads
   * as a partition-pruning hint so they scan the trace's weekly `stored_spans`
   * partitions instead of cold-scanning every partition (incl. cold S3) on each
   * drawer open. Optional: when absent the reads fall back to the full scan, so
   * correctness is unchanged either way.
   */
  occurredAtMs?: number;
  enabled?: boolean;
}) {
  const [state, dispatch] = useReducer(spanTreeReducer, INITIAL_STATE);
  const backfillTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const newFlagTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial paginated load
  const initialQuery = api.tracesV2.spansPaginated.useQuery(
    { projectId, traceId, limit: PAGE_SIZE, offset: 0, occurredAtMs },
    { enabled: enabled && !!projectId && !!traceId },
  );

  // Handle initial load result
  useEffect(() => {
    if (initialQuery.data && state.phase === "loading") {
      dispatch({
        type: "INITIAL_LOAD",
        spans: initialQuery.data.spans,
        total: initialQuery.data.total,
      });
    }
  }, [initialQuery.data, state.phase]);

  // Background backfill fetching
  const utils = api.useUtils();

  useEffect(() => {
    if (state.phase !== "backfilling" || !enabled) return;

    const fetchNextBatch = async () => {
      try {
        const result = await utils.tracesV2.spansPaginated.fetch({
          projectId,
          traceId,
          limit: PAGE_SIZE,
          offset: state.nextOffset,
          occurredAtMs,
        });
        dispatch({ type: "BATCH_LOADED", spans: result.spans });

        // Update total in case new spans were ingested during backfill
        if (result.total !== state.total) {
          dispatch({ type: "SET_TOTAL", total: result.total });
        }
      } catch {
        // Retry on next tick
      }
    };

    backfillTimerRef.current = setTimeout(() => {
      void fetchNextBatch();
    }, BACKFILL_DELAY_MS);

    return () => {
      if (backfillTimerRef.current) {
        clearTimeout(backfillTimerRef.current);
        backfillTimerRef.current = null;
      }
    };
  }, [state.phase, state.nextOffset, state.total, enabled, projectId, traceId, occurredAtMs, utils]);

  // Delta fetch callback for SSE events
  const onSpanStored = useCallback(async () => {
    if (!enabled || !projectId || !traceId) return;
    try {
      const deltaSpans = await utils.tracesV2.spansDelta.fetch({
        projectId,
        traceId,
        sinceStartTimeMs: state.highWaterMark,
        occurredAtMs,
      });
      if (deltaSpans.length > 0) {
        dispatch({ type: "DELTA_RECEIVED", spans: deltaSpans });
      }
    } catch {
      // Silently fail — next SSE event will retry
    }
  }, [enabled, projectId, traceId, occurredAtMs, state.highWaterMark, utils]);

  // Clear new flags after animation
  useEffect(() => {
    if (state.newSpanIds.size === 0) return;

    if (newFlagTimerRef.current) {
      clearTimeout(newFlagTimerRef.current);
    }
    newFlagTimerRef.current = setTimeout(() => {
      dispatch({ type: "CLEAR_NEW_FLAGS" });
      newFlagTimerRef.current = null;
    }, 1500);

    return () => {
      if (newFlagTimerRef.current) {
        clearTimeout(newFlagTimerRef.current);
        newFlagTimerRef.current = null;
      }
    };
  }, [state.newSpanIds]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (backfillTimerRef.current) clearTimeout(backfillTimerRef.current);
      if (newFlagTimerRef.current) clearTimeout(newFlagTimerRef.current);
    };
  }, []);

  // Sorted spans array
  const sortedSpans = (() => {
    const arr = [...state.spans.values()];
    arr.sort((a, b) => {
      const startDiff =
        (a.timestamps?.started_at ?? 0) - (b.timestamps?.started_at ?? 0);
      if (startDiff === 0) {
        return (
          (b.timestamps?.finished_at ?? 0) - (a.timestamps?.finished_at ?? 0)
        );
      }
      return startDiff;
    });
    return arr;
  })();

  return {
    spans: sortedSpans,
    newSpanIds: state.newSpanIds,
    total: state.total,
    loadedCount: state.spans.size,
    phase: state.phase,
    isLoading: state.phase === "loading",
    isBackfilling: state.phase === "backfilling",
    onSpanStored,
    error: initialQuery.error,
  };
}
