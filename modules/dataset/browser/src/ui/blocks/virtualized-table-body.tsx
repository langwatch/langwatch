/**
 * Memoized table body for virtualized rows, extracted to prevent the
 * entire EvaluationsV3Table re-rendering on every scroll event — the
 * virtualizer state is contained here.
 */
import type { Row } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import React, { useCallback, useEffect } from "react";

import { type DatasetTableRowData, useDatasetTable } from "../../model/dataset-table-context.tsx";
import { TableCell } from "../elements/table-cell.tsx";

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
  /** Width of a trailing spacer column (e.g. room for an overlaying side
   *  drawer). When set, each row gets a filler cell too, and the host must
   *  declare matching filler + spacer entries in its colgroup/thead. */
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
  const getScrollElement = useCallback(() => scrollContainer, [scrollContainer]);
  const estimateSize = useCallback(() => COMPACT_ROW_HEIGHT, []);

  // Set up row virtualization (contained in this component to prevent parent re-renders)
  const rowVirtualizer = useVirtualizer({
    count: displayRowCount,
    getScrollElement,
    estimateSize,
    overscan: 5, // Render 5 extra rows above/below viewport for smooth scrolling
    enabled: shouldVirtualize && !!scrollContainer,
  });
  useScrollToSelectedRow({ rowVirtualizer, enabled: shouldVirtualize && !disableVirtualization });

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
            data-selected={selectedRows.has(row.index) ? "true" : void 0}
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
                <td aria-hidden="true" style={{ width: "auto" }} />
                <td
                  aria-hidden="true"
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
    virtualRows.length > 0 ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0) : 0;

  return (
    <>
      {/* Top padding row */}
      {paddingTop > 0 && (
        <tr>
          <td
            aria-hidden="true"
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
            data-selected={selectedRows.has(row.index) ? "true" : void 0}
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
                aria-hidden="true"
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
            aria-hidden="true"
            style={{ height: `${paddingBottom}px`, padding: 0 }}
            colSpan={columnCount}
          />
        </tr>
      )}
    </>
  );
}

/**
 * A selected row outside the rendered window has no cell to scroll into view,
 * so the keyboard would move the selection out of sight; scroll the grid to it.
 */
function useScrollToSelectedRow({
  rowVirtualizer,
  enabled,
}: {
  rowVirtualizer: ReturnType<typeof useVirtualizer<HTMLElement, Element>>;
  enabled: boolean;
}) {
  const { selectedCell } = useDatasetTable();
  // Any move, a row or only a column, can land on a row scrolled out of the window.
  useEffect(() => {
    if (!enabled || !selectedCell) return;
    const { row } = selectedCell;
    const isRendered = rowVirtualizer.getVirtualItems().some((item) => item.index === row);
    if (!isRendered) rowVirtualizer.scrollToIndex(row, { align: "auto" });
  }, [enabled, selectedCell, rowVirtualizer]);
}

/**
 * Memoized by hand: `useVirtualizer` is on the React Compiler's incompatible-
 * library list, so it skips this component; without this every editor render
 * repaints every row. The cast keeps the generic row type React.memo erases.
 */
export const VirtualizedTableBody = React.memo(
  VirtualizedTableBodyImpl,
) as typeof VirtualizedTableBodyImpl;
