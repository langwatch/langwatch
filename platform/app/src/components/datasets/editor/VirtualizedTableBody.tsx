/**
 * VirtualizedTableBody - Memoized table body component for virtualized rows.
 *
 * This component is extracted to prevent the entire EvaluationsV3Table from
 * re-rendering on every scroll event. The virtualizer state is contained here.
 */
import type { Row } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import React, { useCallback } from "react";
import type { DatasetTableRowData } from "./DatasetTableContext";
import { TableCell } from "./TableCell";

// Fixed row height for compact mode
const COMPACT_ROW_HEIGHT = 160;

type VirtualizedTableBodyProps<TData extends DatasetTableRowData> = {
  rows: Row<TData>[];
  scrollContainer: HTMLElement | null;
  columnCount: number;
  selectedRows: Set<number>;
  activeDatasetId: string;
  isLoading: boolean;
  shouldVirtualize: boolean;
  disableVirtualization: boolean;
  displayRowCount: number;
  /** Width of a trailing spacer column, e.g. to leave room for a side
   *  drawer overlaying the table (the evaluations workbench passes its
   *  drawer width). When set, each row also gets a filler cell absorbing
   *  the remaining width, and the host must declare the matching filler +
   *  spacer entries in its colgroup and thead. Omit to let the data
   *  columns share the full row width. */
  trailingSpacerWidth?: number;
};

/**
 * Memoized table body component that manages its own virtualizer state.
 * This prevents the parent component from re-rendering on scroll.
 */
function VirtualizedTableBodyImpl<TData extends DatasetTableRowData>({
  rows,
  scrollContainer,
  columnCount,
  selectedRows,
  activeDatasetId,
  isLoading,
  shouldVirtualize,
  disableVirtualization,
  displayRowCount,
  trailingSpacerWidth,
}: VirtualizedTableBodyProps<TData>) {
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
  // - Fit mode with <= 100 rows
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
            {trailingSpacerWidth ? (
              <>
                {/* Filler column - absorbs remaining space */}
                <td style={{ width: "auto" }} />
                <td
                  style={{
                    width: trailingSpacerWidth,
                    minWidth: trailingSpacerWidth,
                  }}
                />
              </>
            ) : null}
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
            {trailingSpacerWidth ? (
              /* Filler column - absorbs remaining space (+ drawer spacer) */
              <td
                colSpan={2}
                style={{ width: "auto", minWidth: trailingSpacerWidth }}
              />
            ) : null}
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
}

/**
 * Memoized table body that manages its own virtualizer state so the parent
 * table doesn't re-render on scroll. The cast keeps the generic row type,
 * which React.memo would otherwise erase.
 */
export const VirtualizedTableBody = React.memo(
  VirtualizedTableBodyImpl,
) as typeof VirtualizedTableBodyImpl;
