import { type Virtualizer, useVirtualizer } from "@tanstack/react-virtual";
import { useCallback } from "react";
import { useViewStore } from "../../stores/viewStore";
import { useTraceTableScrollRef } from "./scrollContext";

/** Px estimate per row before measureElement runs. */
const ESTIMATE_PER_DENSITY: Record<"compact" | "comfortable", number> = {
  compact: 36,
  comfortable: 64,
};

/** Extra px per addon (IO preview, status detail, etc.). */
const ESTIMATE_PER_ADDON = 40;

interface VirtualizerArgs {
  count: number;
  addonCount: number;
}

interface VirtualizerResult {
  virtualizer: Virtualizer<HTMLElement, HTMLTableSectionElement>;
  paddingTop: number;
  paddingBottom: number;
}

/**
 * Shared virtualizer for the trace lens bodies. Each "item" is one row's
 * outer <tbody>; spacers are emitted by the lens body.
 */
export function useTraceTableVirtualizer({
  count,
  addonCount,
}: VirtualizerArgs): VirtualizerResult {
  const scrollRef = useTraceTableScrollRef();
  const density = useViewStore((s) => s.density);

  const baseEstimate =
    ESTIMATE_PER_DENSITY[density] + addonCount * ESTIMATE_PER_ADDON;

  const getScrollElement = useCallback(() => scrollRef.current, [scrollRef]);
  const estimateSize = useCallback(() => baseEstimate, [baseEstimate]);

  const virtualizer = useVirtualizer<HTMLElement, HTMLTableSectionElement>({
    count,
    getScrollElement,
    estimateSize,
    overscan: 8,
  });

  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const paddingTop = items.length > 0 ? (items[0]?.start ?? 0) : 0;
  const paddingBottom =
    items.length > 0 ? totalSize - (items[items.length - 1]?.end ?? 0) : 0;

  return { virtualizer, paddingTop, paddingBottom };
}
