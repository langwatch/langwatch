import { Box, Flex } from "@chakra-ui/react";
import type React from "react";
import type { ColumnMeta } from "./TraceTableShell";

/**
 * Skeleton bars to render inside a real table cell while data is
 * loading. Every bar is the same `SKELETON_BAR_HEIGHT` so the loading
 * state looks like a tidy stack of placeholder text instead of a
 * collage of mismatched stripes. The width — not the height — varies
 * to imply different cell content.
 */
const SKELETON_BAR_HEIGHT = "10px";

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
        <Box
          key={lineIdx}
          width={widthFor(rowIdx, colIdx, lineIdx)}
          height={SKELETON_BAR_HEIGHT}
          borderRadius="full"
          bg="fg.muted/20"
        />
      ))}
    </Flex>
  );
};

interface SkeletonAddonRowProps {
  /** Width of the longest skeleton line, varied per row for rhythm. */
  rowIdx: number;
}

/**
 * Stand-in for the IO-preview addon (the only addon that renders
 * unconditionally for trace-list rows). Two lines, same bar height as
 * the cell skeletons above, and round icons sized to the bar height
 * so the whole stack reads as one consistent placeholder.
 */
export const SkeletonAddonRow: React.FC<SkeletonAddonRowProps> = ({
  rowIdx,
}) => {
  const inputWidth = widthFor(rowIdx, 1, 0);
  const outputWidth = widthFor(rowIdx, 2, 0);
  return (
    <Flex direction="column" gap="6px" paddingY={1}>
      <Flex align="center" gap={2}>
        <Box
          width={SKELETON_BAR_HEIGHT}
          height={SKELETON_BAR_HEIGHT}
          borderRadius="full"
          bg="fg.muted/20"
        />
        <Box
          height={SKELETON_BAR_HEIGHT}
          width={inputWidth}
          borderRadius="full"
          bg="fg.muted/20"
        />
      </Flex>
      <Flex align="center" gap={2}>
        <Box
          width={SKELETON_BAR_HEIGHT}
          height={SKELETON_BAR_HEIGHT}
          borderRadius="full"
          bg="fg.muted/20"
        />
        <Box
          height={SKELETON_BAR_HEIGHT}
          width={outputWidth}
          borderRadius="full"
          bg="fg.muted/20"
        />
      </Flex>
    </Flex>
  );
};
