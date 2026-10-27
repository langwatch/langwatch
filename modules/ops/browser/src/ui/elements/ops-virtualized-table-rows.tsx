/** VirtualizedTableRows via spacer rows; non-virtualized render for small tables. */
import { ListTable } from "@langwatch/design-system/list-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Fragment, type ReactNode, type RefObject, useEffect, useReducer } from "react";

interface Props {
  count: number;
  rowHeight: number;
  columnCount: number;
  /**
   * Ref to the scrolling element. When the scroller mounts in the same commit,
   * its ref is still null in react-virtual's layout effect; one re-render after
   * commit lets the virtualizer attach to it.
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

  const [, attachScroller] = useReducer((attempts: number) => attempts + 1, 0);

  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => rowHeight,
    overscan,
    enabled: shouldVirtualize,
    getItemKey,
  });

  useEffect(() => {
    if (shouldVirtualize && virtualizer.scrollElement !== scrollContainerRef.current) {
      attachScroller();
    }
  }, [scrollContainerRef, shouldVirtualize, virtualizer.scrollElement]);

  if (!shouldVirtualize) {
    const rows: ReactNode[] = [];
    for (let i = 0; i < count; i++) {
      rows.push(<Fragment key={getItemKey?.(i) ?? i}>{renderRow(i)}</Fragment>);
    }
    return <>{rows}</>;
  }

  const virtualItems = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = virtualItems.length > 0 ? (virtualItems[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualItems.length > 0 ? totalSize - (virtualItems[virtualItems.length - 1]?.end ?? 0) : 0;

  return (
    <>
      {paddingTop > 0 && <ListTable.PaddingRow columns={columnCount} height={paddingTop} />}
      {virtualItems.map((vi) => (
        <Fragment key={vi.key}>{renderRow(vi.index)}</Fragment>
      ))}
      {paddingBottom > 0 && <ListTable.PaddingRow columns={columnCount} height={paddingBottom} />}
    </>
  );
}
