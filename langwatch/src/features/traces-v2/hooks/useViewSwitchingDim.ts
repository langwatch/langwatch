import { useEffect, useRef, useState } from "react";
import { useFilterStore } from "../stores/filterStore";
import { useRefreshUIStore } from "../stores/refreshUIStore";
import { useViewStore } from "../stores/viewStore";

interface DimInputs {
  isFetching: boolean;
  isFetched: boolean;
  isPreviousData: boolean;
}

/**
 * Coordinates the "view switching" dim signal + refresh pulse for the trace
 * list. We dim only when the user explicitly switches view (filter, sort,
 * page, pageSize, or a non-rolling time-range change). `isPreviousData` fires
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
  isPreviousData,
}: DimInputs): void {
  const queryText = useFilterStore((s) => s.debouncedQueryText);
  const timeRangeFrom = useFilterStore((s) => s.debouncedTimeRange.from);
  const timeRangeTo = useFilterStore((s) => s.debouncedTimeRange.to);
  const timeRangeLabel = useFilterStore((s) => s.debouncedTimeRange.label);
  const page = useFilterStore((s) => s.page);
  const pageSize = useFilterStore((s) => s.pageSize);
  const sortColumnId = useViewStore((s) => s.sort.columnId);
  const sortDirection = useViewStore((s) => s.sort.direction);
  const activeLensId = useViewStore((s) => s.activeLensId);

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
      prev.activeLensId !== next.activeLensId;

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
  ]);

  useEffect(() => {
    if (viewSwitching && !isFetching && isFetched) {
      setViewSwitching(false);
    }
  }, [viewSwitching, isFetching, isFetched]);

  useEffect(() => {
    setReplacingData(viewSwitching && isPreviousData);
  }, [viewSwitching, isPreviousData, setReplacingData]);

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
