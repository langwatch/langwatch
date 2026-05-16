import { Box, Flex } from "@chakra-ui/react";
import type React from "react";
import type { ColumnMeta } from "./TraceTableShell";

/**
 * Skeleton bars to render inside a real table cell while data is
 * loading. Width is varied deterministically so each cell looks like
 * it might carry real content; height tracks the column's declared
 * `meta.skeletonLines` so multi-line cells (model + provider, tokens
 * in/out) still occupy roughly their real height.
 */
interface SkeletonCellContentProps {
  meta: ColumnMeta | undefined;
  rowIdx: number;
  colIdx: number;
}

const WIDTH_VARIANTS = ["38%", "55%", "72%", "46%", "82%", "60%", "70%"];

const widthFor = (rowIdx: number, colIdx: number, lineIdx: number): string =>
  WIDTH_VARIANTS[(rowIdx * 7 + colIdx * 11 + lineIdx * 3) % WIDTH_VARIANTS.length]!;

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
      gap={lines > 1 ? "5px" : 0}
    >
      {Array.from({ length: lines }).map((_, lineIdx) => (
        <Box
          key={lineIdx}
          width={widthFor(rowIdx, colIdx, lineIdx)}
          height={lineIdx === 0 ? "10px" : "7px"}
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
 * unconditionally for trace-list rows). Renders two skeleton bars
 * approximating the input / output preview lines so the row's overall
 * height matches what the user will see once data lands.
 */
export const SkeletonAddonRow: React.FC<SkeletonAddonRowProps> = ({
  rowIdx,
}) => {
  const inputWidth = widthFor(rowIdx, 1, 0);
  const outputWidth = widthFor(rowIdx, 2, 0);
  return (
    <Flex direction="column" gap="6px" paddingY={1}>
      <Flex align="center" gap={2}>
        <Box width="10px" height="10px" borderRadius="full" bg="fg.muted/20" />
        <Box
          height="9px"
          width={inputWidth}
          borderRadius="full"
          bg="fg.muted/20"
        />
      </Flex>
      <Flex align="center" gap={2}>
        <Box width="10px" height="10px" borderRadius="full" bg="fg.muted/20" />
        <Box
          height="9px"
          width={outputWidth}
          borderRadius="full"
          bg="fg.muted/20"
        />
      </Flex>
    </Flex>
  );
};
