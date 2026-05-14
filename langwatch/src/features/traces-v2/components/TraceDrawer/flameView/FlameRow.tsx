import { Box } from "@chakra-ui/react";
import type { VirtualItem } from "@tanstack/react-virtual";
import { ROW_HEIGHT } from "./constants";
import { FlameBlock } from "./FlameBlock";
import type { FlameNode, Viewport } from "./types";

interface RelatedSpanIds {
  ancestors: Set<string>;
  children: Set<string>;
  descendants: Set<string>;
}

interface FlameRowProps {
  virtualRow: VirtualItem;
  rowNodes: FlameNode[] | undefined;
  viewport: Viewport;
  fullDur: number;
  totalSpanCount: number;
  selectedSpanId: string | null;
  hoveredSpanId: string | null;
  focusedSpanId: string | null;
  relatedSpanIds: RelatedSpanIds | null;
  dimOnHover: boolean;
  onSpanClick: (spanId: string) => void;
  onSpanDoubleClick: (spanId: string) => void;
  onHoverChange: (spanId: string | null) => void;
}

/**
 * One virtualised flame-graph depth row. Stripes alternate-depth rows so the
 * eye can track horizontal alignment across long traces. Each row hosts the
 * span blocks at its depth.
 */
export function FlameRow({
  virtualRow,
  rowNodes,
  viewport,
  fullDur,
  totalSpanCount,
  selectedSpanId,
  hoveredSpanId,
  focusedSpanId,
  relatedSpanIds,
  dimOnHover,
  onSpanClick,
  onSpanDoubleClick,
  onHoverChange,
}: FlameRowProps) {
  const depth = virtualRow.index;
  const isStripe = depth % 2 === 1;
  return (
    <Box
      position="absolute"
      top={0}
      left={0}
      right={0}
      height={`${virtualRow.size}px`}
      transform={`translateY(${virtualRow.start}px)`}
      pointerEvents="none"
    >
      {isStripe && (
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          height={`${ROW_HEIGHT}px`}
          bg="bg.subtle"
          opacity={0.5}
          pointerEvents="none"
        />
      )}
      {rowNodes?.map((node) => (
        <FlameBlock
          key={node.span.spanId}
          node={node}
          depth={depth}
          viewport={viewport}
          fullDur={fullDur}
          totalSpanCount={totalSpanCount}
          selectedSpanId={selectedSpanId}
          hoveredSpanId={hoveredSpanId}
          focusedSpanId={focusedSpanId}
          relatedSpanIds={relatedSpanIds}
          dimOnHover={dimOnHover}
          onSpanClick={onSpanClick}
          onSpanDoubleClick={onSpanDoubleClick}
          onHoverChange={onHoverChange}
        />
      ))}
    </Box>
  );
}
