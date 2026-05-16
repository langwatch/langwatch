import { Flex, Skeleton } from "@chakra-ui/react";
import type React from "react";
import type { ColumnMeta } from "./TraceTableShell";

/**
 * Skeleton bars rendered inside the real table cells while data loads.
 * Uses Chakra's `<Skeleton>` so we get the built-in shimmer animation —
 * the previous custom `<Box bg="…/20">` looked dead because nothing
 * was animating. Matches the old `MessagesTable` height (16px) so the
 * loading state and the legacy traces page feel like the same product.
 */
const SKELETON_BAR_HEIGHT = "16px";

const WIDTH_VARIANTS = ["38%", "55%", "72%", "46%", "82%", "60%", "70%"];

const widthFor = (rowIdx: number, colIdx: number, lineIdx: number): string =>
  WIDTH_VARIANTS[(rowIdx * 7 + colIdx * 11 + lineIdx * 3) % WIDTH_VARIANTS.length]!;

interface SkeletonCellContentProps {
  meta: ColumnMeta | undefined;
  rowIdx: number;
  colIdx: number;
}

export const SkeletonCellContent: React.FC<SkeletonCellContentProps> = ({
  meta,
  rowIdx,
  colIdx,
}) => {
  const align = meta?.align ?? "left";
  const lines = Math.max(meta?.skeletonLines ?? 1, 1);
  return (
    <Flex
      direction="column"
      align={align === "right" ? "flex-end" : "flex-start"}
      gap={lines > 1 ? "6px" : 0}
    >
      {Array.from({ length: lines }).map((_, lineIdx) => (
        <Skeleton
          key={lineIdx}
          width={widthFor(rowIdx, colIdx, lineIdx)}
          height={SKELETON_BAR_HEIGHT}
          borderRadius="sm"
        />
      ))}
    </Flex>
  );
};

/**
 * Placeholder for the bulk-select checkbox column — matches the
 * checkbox's visual footprint (small square) so the column doesn't
 * appear empty next to the rest of the row's shimmer bars.
 */
export const SkeletonSelectCell: React.FC = () => (
  <Flex align="center" justify="center" height="full" paddingX={2}>
    <Skeleton width="20px" height="14px" borderRadius="sm" />
  </Flex>
);

interface SkeletonAddonRowProps {
  /** Width of the longest skeleton line, varied per row for rhythm. */
  rowIdx: number;
}

/** Cap the IO-preview skeleton lines to roughly the real text length so
 * the placeholder doesn't sprawl across the full table width. */
const IO_SKELETON_MAX_WIDTH = "300px";

/**
 * Stand-in for the IO-preview addon (the only addon that renders
 * unconditionally for trace-list rows). Two skeleton lines, no
 * leading-icon placeholders — the previous round-dot stand-ins for
 * the ↑/↓ arrows added visual noise without telling the user
 * anything useful while loading.
 */
export const SkeletonAddonRow: React.FC<SkeletonAddonRowProps> = ({
  rowIdx,
}) => {
  const inputWidth = widthFor(rowIdx, 1, 0);
  const outputWidth = widthFor(rowIdx, 2, 0);
  return (
    <Flex direction="column" gap="6px" paddingY={1}>
      <Skeleton
        height={SKELETON_BAR_HEIGHT}
        width={inputWidth}
        maxWidth={IO_SKELETON_MAX_WIDTH}
        borderRadius="sm"
      />
      <Skeleton
        height={SKELETON_BAR_HEIGHT}
        width={outputWidth}
        maxWidth={IO_SKELETON_MAX_WIDTH}
        borderRadius="sm"
      />
    </Flex>
  );
};
