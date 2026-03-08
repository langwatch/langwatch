import { useCallback, useEffect, useRef, useState } from "react";

/** Any data shape that contains groups of items with trace_id */
export interface TraceGroupData {
  groups: { trace_id: string }[][];
}

export interface UseBufferedTraceDataOptions<T extends TraceGroupData> {
  /** Latest data from the tRPC query (drives the buffer/display decision) */
  freshData: T | undefined;
  /** Whether the user's mouse is currently over the table area */
  isMouseOnTable: boolean;
}

export interface UseBufferedTraceDataReturn<T extends TraceGroupData> {
  /** The data the table should render */
  displayData: T | undefined;
  /** Buffered data waiting to be applied (non-undefined when new traces arrived while user is reading) */
  pendingData: T | undefined;
  /** Number of new traces waiting in the buffer */
  pendingCount: number;
  /** Set of trace IDs that should show highlight animation */
  highlightIds: Set<string>;
  /** Apply buffered data immediately (e.g. when user clicks "N new" pill) */
  acceptPending: () => void;
  /** Ref tracking when the mouse last left the table (epoch ms, 0 = mouse is on table) */
  mouseLeftAtRef: React.MutableRefObject<number>;
  /** Ref that bypasses the mouse-on-table buffer for the next data arrival */
  bypassBufferRef: React.MutableRefObject<boolean>;
  /** Ref mirroring displayData for use in callbacks that would otherwise close over stale state */
  displayDataRef: React.MutableRefObject<T | undefined>;
  /** Increment pending count externally (e.g. from SSE handler when new traces are detected) */
  addPendingCount: (count: number) => void;
  /** Reset all buffering state (e.g. when user-driven query params change) */
  reset: () => void;
}

/**
 * Manages buffered display of trace data so that incoming updates
 * don't disrupt the user while they are actively reading the table.
 *
 * When `isMouseOnTable` is true (and bypass is not set), new traces
 * are held in a pending buffer. Once the user moves the mouse away
 * (or explicitly accepts via `acceptPending`), the pending data is
 * applied with a brief highlight animation on the new rows.
 */
export function useBufferedTraceData<T extends TraceGroupData>({
  freshData,
  isMouseOnTable,
}: UseBufferedTraceDataOptions<T>): UseBufferedTraceDataReturn<T> {
  const [displayData, setDisplayData] = useState<T | undefined>(undefined);
  const [pendingData, setPendingData] = useState<T | undefined>(undefined);
  const [pendingCount, setPendingCount] = useState(0);
  const [highlightIds, setHighlightIds] = useState<Set<string>>(new Set());

  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bypassBufferRef = useRef(false);
  const mouseLeftAtRef = useRef<number>(0);
  const displayDataRef = useRef(displayData);
  displayDataRef.current = displayData;

  /** Schedule highlight removal after 2 s */
  const scheduleHighlightClear = () => {
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
    }
    highlightTimerRef.current = setTimeout(
      () => setHighlightIds(new Set()),
      2000,
    );
  };

  // Decide how to display new data from the query.
  // Depends on both freshData AND displayData so that when reset() clears
  // displayData while freshData is already cached (same reference), the
  // effect still fires and populates displayData from the cache.
  useEffect(() => {
    if (!freshData) return;

    // Already showing this exact data -- nothing to do
    if (displayData === freshData) return;

    // First load or after reset -- just show the data
    if (!displayData) {
      setDisplayData(freshData);
      return;
    }

    const currentIds = new Set(
      freshData.groups.flatMap((g) => g.map((t) => t.trace_id)),
    );
    const displayedIds = new Set(
      displayData.groups.flatMap((g) => g.map((t) => t.trace_id)),
    );
    const newIds = new Set(
      [...currentIds].filter((id) => !displayedIds.has(id)),
    );

    // Completely different data set (filter/sort/page change) -- replace immediately
    const overlap = [...currentIds].filter((id) => displayedIds.has(id));
    if (overlap.length === 0 && displayedIds.size > 0) {
      setDisplayData(freshData);
      setPendingData(undefined);
      setPendingCount(0);
      setHighlightIds(new Set());
      return;
    }

    if (newIds.size === 0) {
      // Only updates to existing traces -- swap silently
      setDisplayData(freshData);
    } else if (isMouseOnTable && !bypassBufferRef.current) {
      // New traces but user is reading -- buffer
      setPendingData(freshData);
      setPendingCount(newIds.size);
    } else {
      // New traces, user not looking (or bypass active) -- show with highlight
      bypassBufferRef.current = false;
      setHighlightIds(newIds);
      setDisplayData(freshData);
      setPendingCount(0);
      scheduleHighlightClear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freshData, displayData]);

  // Auto-apply pending data when mouse leaves the table
  useEffect(() => {
    if (
      !isMouseOnTable &&
      pendingData &&
      displayData &&
      !bypassBufferRef.current
    ) {
      const displayedIds = new Set(
        displayData.groups.flatMap((g) => g.map((t) => t.trace_id)),
      );
      const freshIds = new Set(
        pendingData.groups.flatMap((g) => g.map((t) => t.trace_id)),
      );
      const newIds = new Set(
        [...freshIds].filter((id) => !displayedIds.has(id)),
      );
      setHighlightIds(newIds);
      setDisplayData(pendingData);
      setPendingData(undefined);
      setPendingCount(0);
      scheduleHighlightClear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMouseOnTable]);

  const acceptPending = () => {
    if (pendingData && displayData) {
      // We have buffered data from a visible-trace refetch that arrived
      // while the mouse was on the table -- show it now.
      const displayedIds = new Set(
        displayData.groups.flatMap((g) => g.map((t) => t.trace_id)),
      );
      const freshIds = new Set(
        pendingData.groups.flatMap((g) => g.map((t) => t.trace_id)),
      );
      const newIds = new Set(
        [...freshIds].filter((id) => !displayedIds.has(id)),
      );
      setHighlightIds(newIds);
      setDisplayData(pendingData);
      setPendingData(undefined);
      scheduleHighlightClear();
    }

    // Bump bypass so the next data arrival goes through immediately
    bypassBufferRef.current = true;
    setPendingCount(0);
  };

  const addPendingCount = (count: number) => {
    setPendingCount((prev) => prev + count);
  };

  const reset = useCallback(() => {
    setDisplayData(undefined);
    setPendingData(undefined);
    setPendingCount(0);
    setHighlightIds(new Set());
    bypassBufferRef.current = false;
    mouseLeftAtRef.current = 0;
    if (highlightTimerRef.current) {
      clearTimeout(highlightTimerRef.current);
      highlightTimerRef.current = null;
    }
  }, []);

  // Cleanup highlight timer on unmount
  useEffect(() => {
    return () => {
      if (highlightTimerRef.current) {
        clearTimeout(highlightTimerRef.current);
      }
    };
  }, []);

  return {
    displayData,
    pendingData,
    pendingCount,
    highlightIds,
    acceptPending,
    mouseLeftAtRef,
    bypassBufferRef,
    displayDataRef,
    addPendingCount,
    reset,
  };
}
