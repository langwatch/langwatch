import { useEffect, useRef, useState } from "react";
import { useDensityStore } from "../stores/densityStore";
import { useExplorerStore } from "../stores/explorerStore";
import { useRefreshUIStore } from "../stores/refreshUIStore";

interface DimInputs {
  isFetching: boolean;
  isFetched: boolean;
  isPlaceholderData: boolean;
}

/**
 * Coordinates the "view switching" dim signal + refresh pulse for the trace
 * list. We dim only when the user explicitly switches view (filter, sort,
 * page, pageSize, or a non-rolling time-range change). `isPlaceholderData` fires
 * on every key change including the rolling-time-range tail update, which
 * would dim every minute on a live view — so we gate it behind a stable
 * "view key" that ignores from/to drift while a label preset is active.
 *
 * Primitive comparison instead of JSON.stringify keeps this allocation-free
 * on the hot path.
 */
export function useViewSwitchingDim({
  isFetching,
  isFetched,
  isPlaceholderData,
}: DimInputs): void {
  const queryText = useExplorerStore((s) => s.debouncedQueryText);
  const timeRangeFrom = useExplorerStore((s) => s.debouncedTimeRange.from);
  const timeRangeTo = useExplorerStore((s) => s.debouncedTimeRange.to);
  const timeRangeLabel = useExplorerStore((s) => s.debouncedTimeRange.label);
  const page = useExplorerStore((s) => s.page);
  const pageSize = useExplorerStore((s) => s.pageSize);
  const sortColumnId = useExplorerStore((s) => s.sort.columnId);
  const sortDirection = useExplorerStore((s) => s.sort.direction);
  const activeLensId = useExplorerStore((s) => s.activeLensId);
  const density = useDensityStore((s) => s.density);

  const pulse = useRefreshUIStore((s) => s.pulse);
  const setReplacingData = useRefreshUIStore((s) => s.setReplacingData);

  // Snapshot of the previous "view key" — when label is active, ignore from/to
  // drift to avoid dimming on every rolling-window tick.
  const prevRef = useRef({
    queryText,
    timeRangeLabel,
    timeRangeFrom: timeRangeLabel ? null : timeRangeFrom,
    timeRangeTo: timeRangeLabel ? null : timeRangeTo,
    page,
    pageSize,
    sortColumnId,
    sortDirection,
    activeLensId,
    density,
  });

  const [viewSwitching, setViewSwitching] = useState(false);

  useEffect(() => {
    const next = {
      queryText,
      timeRangeLabel,
      timeRangeFrom: timeRangeLabel ? null : timeRangeFrom,
      timeRangeTo: timeRangeLabel ? null : timeRangeTo,
      page,
      pageSize,
      sortColumnId,
      sortDirection,
      activeLensId,
      density,
    };
    const prev = prevRef.current;
    const changed =
      prev.queryText !== next.queryText ||
      prev.timeRangeLabel !== next.timeRangeLabel ||
      prev.timeRangeFrom !== next.timeRangeFrom ||
      prev.timeRangeTo !== next.timeRangeTo ||
      prev.page !== next.page ||
      prev.pageSize !== next.pageSize ||
      prev.sortColumnId !== next.sortColumnId ||
      prev.sortDirection !== next.sortDirection ||
      prev.activeLensId !== next.activeLensId ||
      prev.density !== next.density;

    if (changed) {
      prevRef.current = next;
      setViewSwitching(true);
    }
  }, [
    queryText,
    timeRangeLabel,
    timeRangeFrom,
    timeRangeTo,
    page,
    pageSize,
    sortColumnId,
    sortDirection,
    activeLensId,
    density,
  ]);

  useEffect(() => {
    if (viewSwitching && !isFetching && isFetched) {
      setViewSwitching(false);
    }
  }, [viewSwitching, isFetching, isFetched]);

  useEffect(() => {
    setReplacingData(viewSwitching && (isPlaceholderData || isFetching));
  }, [viewSwitching, isPlaceholderData, isFetching, setReplacingData]);

  // Publish refresh state via the freshness store's pulse action so the
  // aurora bar + LiveIndicator spinner show every time the query updates.
  // Cache hits can resolve before isFetching ever flips, so we trigger from
  // viewSwitching too. The pulse action owns its own timer and self-clears,
  // which dedupes overlapping triggers.
  const isRefetching = isFetching && isFetched;
  const wantsRefresh = isRefetching || viewSwitching;
  const wasRefreshingRef = useRef(false);
  useEffect(() => {
    if (wantsRefresh && !wasRefreshingRef.current) {
      wasRefreshingRef.current = true;
      pulse();
      return;
    }
    if (!wantsRefresh && wasRefreshingRef.current) {
      wasRefreshingRef.current = false;
    }
  }, [wantsRefresh, pulse]);
}
