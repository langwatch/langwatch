/** VirtualizedTableRows via spacer rows; non-virtualized render for small tables. */
import { Table } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Fragment, type ReactNode, type RefObject, useCallback } from "react";

interface Props {
  count: number;
  rowHeight: number;
  columnCount: number;
  /**
   * Ref to the scrolling element. A ref, not stateful `HTMLElement | null`,
   * keeps the DOM node out of React state - react-virtual reads `.current`
   * lazily from its layout effects, picking it up after commit with no render.
   */
  scrollContainerRef: RefObject<HTMLElement | null>;
  renderRow: (index: number) => ReactNode;
  /**
   * Stable per-row key. Without it, react-virtual keys rows by index, so a
   * row moving from index 3 to 5 reuses the DOM node and leaks state. Pass
   * `(i) => list[i].id` whenever the underlying list can reorder.
   */
  getItemKey?: (index: number) => string | number;
  /** Skip virtualization for short lists (default: 30). */
  threshold?: number;
  overscan?: number;
}

export function VirtualizedTableRows({
  count,
  rowHeight,
  columnCount,
  scrollContainerRef,
  renderRow,
  getItemKey,
  threshold = 30,
  overscan = 6,
}: Props) {
  const shouldVirtualize = count > threshold;

  const getScrollElement = useCallback(() => scrollContainerRef.current, [scrollContainerRef]);
  const estimateSize = useCallback(() => rowHeight, [rowHeight]);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement,
    estimateSize,
    overscan,
    enabled: shouldVirtualize,
    getItemKey,
  });

  if (!shouldVirtualize) {
    const rows: ReactNode[] = [];
    for (let i = 0; i < count; i++) rows.push(renderRow(i));
    return <>{rows}</>;
  }

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? (virtualItems[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualItems.length > 0 ? totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0) : 0;

  return (
    <>
      {paddingTop > 0 && (
        <Table.Row>
          <Table.Cell
            colSpan={columnCount}
            style={{ height: `${paddingTop}px`, padding: 0, border: "none" }}
          />
        </Table.Row>
      )}
      {virtualItems.map((vi) => (
        <Fragment key={vi.key}>{renderRow(vi.index)}</Fragment>
      ))}
      {paddingBottom > 0 && (
        <Table.Row>
          <Table.Cell
            colSpan={columnCount}
            style={{ height: `${paddingBottom}px`, padding: 0, border: "none" }}
          />
        </Table.Row>
      )}
    </>
  );
}
