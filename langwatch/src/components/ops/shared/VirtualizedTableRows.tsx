/**
 * VirtualizedTableRows — render a long flat list of Chakra Table.Row elements
 * inside a scroll container without paying the cost of mounting every row.
 *
 * Mirrors the padding-row pattern used in evaluations-v3's VirtualizedTableBody:
 * we render top/bottom spacer <tr>s sized to preserve scroll height and only
 * mount the rows currently in (or near) the viewport. Rows below a threshold
 * fall through to a non-virtualized render so small tables stay simple.
 */
import { Table } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Fragment, type ReactNode, type RefObject, useCallback } from "react";

interface Props {
  count: number;
  rowHeight: number;
  columnCount: number;
  /**
   * Ref to the scrolling element. Using a ref (rather than a stateful
   * `HTMLElement | null`) keeps the DOM node out of React state — react-virtual
   * reads `.current` lazily from inside its layout effects, so it picks up the
   * element after the parent commits without needing a render to fire.
   */
  scrollContainerRef: RefObject<HTMLElement | null>;
  renderRow: (index: number) => ReactNode;
  /**
   * Stable per-row key. Without this, react-virtual falls back to the row
   * index, so `vi.key` (which is what wraps each rendered row) reuses DOM
   * across reorders — a row that moves from index 3 to index 5 keeps the
   * DOM node from index 3, leaking state. Pass something like
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

  const getScrollElement = useCallback(
    () => scrollContainerRef.current,
    [scrollContainerRef],
  );
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
    virtualItems.length > 0
      ? totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0)
      : 0;

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
