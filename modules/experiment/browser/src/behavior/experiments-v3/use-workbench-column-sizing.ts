/** The workbench's own column resizing: percentages, not TanStack's pixel resize. */
import type { ColumnSizingState } from "@tanstack/react-table";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  columnWidthCss,
  defaultPctForColumn,
  minPctForColumn,
  totalColumnPct,
} from "../../model/experiments-v3/workbench-column-widths.ts";

type PointerEvent = MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent;

const pointerX = (event: PointerEvent): number =>
  "touches" in event ? (event.touches[0]?.clientX ?? 0) : event.clientX;

const SYNC_DELAY_MS = 100;

/** Tracks the table container's width, for turning a pixel drag into a percentage. */
const useContainerWidth = (tableRef: RefObject<HTMLTableElement | null>): number => {
  const [containerWidth, setContainerWidth] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1200,
  );
  useEffect(() => {
    const handleResize = () =>
      setContainerWidth(tableRef.current?.parentElement?.clientWidth ?? window.innerWidth);
    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [tableRef]);
  return containerWidth;
};

/**
 * Column widths in percent, dragged through a custom handler for a steady feel on
 * any screen, and written to the store shortly after a drag or reset ends.
 */
export const useWorkbenchColumnSizing = ({
  initialWidths,
  setColumnWidths,
  tableRef,
  comparisonTargetIds,
  datasetColumnIds,
  targetIds,
  comparisonEvaluatorIds,
}: {
  initialWidths: ColumnSizingState;
  setColumnWidths: (widths: ColumnSizingState) => void;
  tableRef: RefObject<HTMLTableElement | null>;
  comparisonTargetIds: Set<string>;
  datasetColumnIds: string[];
  targetIds: string[];
  comparisonEvaluatorIds: string[];
}) => {
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>(() => initialWidths);
  const containerWidth = useContainerWidth(tableRef);
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resizingColumnRef = useRef<string | null>(null);

  const syncToStore = useCallback(() => {
    if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current);
    syncTimeoutRef.current = setTimeout(() => {
      setColumnSizing((current) => {
        setColumnWidths(current);
        return current;
      });
    }, SYNC_DELAY_MS);
  }, [setColumnWidths]);

  const createResizeHandler = useCallback(
    (columnId: string, columnType: string) => (event: React.MouseEvent | React.TouchEvent) => {
      event.preventDefault();
      const column = { columnId, columnType, comparisonTargetIds };
      const startX = pointerX(event);
      const startPct = columnSizing[columnId] ?? defaultPctForColumn(column);
      const minPct = minPctForColumn(column);
      resizingColumnRef.current = columnId;

      const handleMove = (moveEvent: MouseEvent | TouchEvent) => {
        const deltaPct = ((pointerX(moveEvent) - startX) / containerWidth) * 100;
        setColumnSizing((prev) => ({ ...prev, [columnId]: Math.max(minPct, startPct + deltaPct) }));
      };
      const handleEnd = () => {
        resizingColumnRef.current = null;
        syncToStore();
        document.removeEventListener("mousemove", handleMove);
        document.removeEventListener("mouseup", handleEnd);
        document.removeEventListener("touchmove", handleMove);
        document.removeEventListener("touchend", handleEnd);
      };
      document.addEventListener("mousemove", handleMove);
      document.addEventListener("mouseup", handleEnd);
      document.addEventListener("touchmove", handleMove);
      document.addEventListener("touchend", handleEnd);
    },
    [columnSizing, containerWidth, comparisonTargetIds, syncToStore],
  );

  const isColumnResizing = useCallback(
    (columnId: string) => resizingColumnRef.current === columnId,
    [],
  );

  /** A double-click puts a column back to its default width. */
  const handleResizeDoubleClick = useCallback(
    (columnId: string, columnType: string) => {
      const defaultPct = defaultPctForColumn({ columnId, columnType, comparisonTargetIds });
      setColumnSizing((prev) => ({ ...prev, [columnId]: defaultPct }));
      syncToStore();
    },
    [comparisonTargetIds, syncToStore],
  );

  const totalColumnPercentage = useMemo(
    () =>
      totalColumnPct({
        columnSizing,
        datasetColumnIds,
        targetIds,
        comparisonEvaluatorIds,
        comparisonTargetIds,
      }),
    [columnSizing, datasetColumnIds, targetIds, comparisonEvaluatorIds, comparisonTargetIds],
  );

  const getColumnWidth = useCallback(
    (columnId: string, columnType: string, isFixedWidth?: boolean): string =>
      columnWidthCss({ columnId, columnType, isFixedWidth, columnSizing, comparisonTargetIds }),
    [columnSizing, comparisonTargetIds],
  );

  return {
    columnSizing,
    createResizeHandler,
    isColumnResizing,
    handleResizeDoubleClick,
    totalColumnPercentage,
    getColumnWidth,
  };
};
