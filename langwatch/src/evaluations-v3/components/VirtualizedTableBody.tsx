/**
 * VirtualizedTableBody - Memoized table body component for virtualized rows.
 *
 * This component is extracted to prevent the entire EvaluationsV3Table from
 * re-rendering on every scroll event. The virtualizer state is contained here.
 */
import type { Row } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import React, { useCallback } from "react";
import type { TableRowData } from "../types";
import { TableCell } from "./DatasetSection/TableCell";

// Drawer width for spacer columns (must match actual drawer width)
const DRAWER_WIDTH = 456;
// Fixed row height for compact mode
const COMPACT_ROW_HEIGHT = 197;

type VirtualizedTableBodyProps = {
  rows: Row<TableRowData>[];
  scrollContainer: HTMLElement | null;
  columnCount: number;
  selectedRows: Set<number>;
  activeDatasetId: string;
  isLoading: boolean;
  shouldVirtualize: boolean;
  disableVirtualization: boolean;
  displayRowCount: number;
};

/**
 * Memoized table body component that manages its own virtualizer state.
 * This prevents the parent component from re-rendering on scroll.
 */
export const VirtualizedTableBody = React.memo(function VirtualizedTableBody({
  rows,
  scrollContainer,
  columnCount,
  selectedRows,
  activeDatasetId,
  isLoading,
  shouldVirtualize,
  disableVirtualization,
  displayRowCount,
}: VirtualizedTableBodyProps) {
  // Stable callbacks for virtualizer
  const getScrollElement = useCallback(
    () => scrollContainer,
    [scrollContainer],
  );
  const estimateSize = useCallback(() => COMPACT_ROW_HEIGHT, []);

  // Set up row virtualization (contained in this component to prevent parent re-renders)
  const rowVirtualizer = useVirtualizer({
    count: displayRowCount,
    getScrollElement,
    estimateSize,
    overscan: 5, // Render 5 extra rows above/below viewport for smooth scrolling
    enabled: shouldVirtualize && !!scrollContainer,
  });

  // Render all rows without virtualization when:
  // - Test mode (disableVirtualization prop)
  // - Expanded mode with <= 100 rows
  if (disableVirtualization || !shouldVirtualize) {
    return (
      <>
        {rows.map((row) => (
          <tr
            key={row.id}
            data-index={row.index}
            data-selected={selectedRows.has(row.index) ? "true" : undefined}
          >
            {row.getVisibleCells().map((cell) => (
              <TableCell
                key={cell.id}
                cell={cell}
                rowIndex={row.index}
                activeDatasetId={activeDatasetId}
                isLoading={isLoading}
              />
            ))}
            {/* Spacer column to match drawer width */}
            <td style={{ width: DRAWER_WIDTH, minWidth: DRAWER_WIDTH }} />
          </tr>
        ))}
      </>
    );
  }

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  // Calculate padding to maintain scroll position
  const paddingTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0;

  return (
    <>
      {/* Top padding row */}
      {paddingTop > 0 && (
        <tr>
          <td
            style={{ height: `${paddingTop}px`, padding: 0 }}
            colSpan={columnCount}
          />
        </tr>
      )}
      {/* Render only virtualized rows */}
      {virtualRows.map((virtualRow) => {
        const row = rows[virtualRow.index];
        if (!row) return null;
        return (
          <tr
            key={row.id}
            data-index={virtualRow.index}
            style={{ height: `${COMPACT_ROW_HEIGHT}px` }}
            data-selected={selectedRows.has(row.index) ? "true" : undefined}
          >
            {row.getVisibleCells().map((cell) => (
              <TableCell
                key={cell.id}
                cell={cell}
                rowIndex={row.index}
                activeDatasetId={activeDatasetId}
                isLoading={isLoading}
              />
            ))}
            {/* Spacer column to match drawer width */}
            <td style={{ width: DRAWER_WIDTH, minWidth: DRAWER_WIDTH }} />
          </tr>
        );
      })}
      {/* Bottom padding row */}
      {paddingBottom > 0 && (
        <tr>
          <td
            style={{ height: `${paddingBottom}px`, padding: 0 }}
            colSpan={columnCount}
          />
        </tr>
      )}
    </>
  );
});
