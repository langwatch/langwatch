import { Box, Flex } from "@chakra-ui/react";
import {
  type ColumnDef,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import type React from "react";
import { useDensityTokens } from "../../hooks/useDensityTokens";
import {
  groupByForGrouping,
  type LensConfig,
  rowKindForGrouping,
  useViewStore,
} from "../../stores/viewStore";
import {
  buildConversationColumns,
  buildGroupColumns,
  buildTraceColumns,
} from "./columns";
import {
  conversationSelectColumnDef,
  groupSelectColumnDef,
  traceSelectColumnDef,
} from "./selectColumn";
import { Td, Tr } from "./TablePrimitives";
import { type ColumnMeta, TraceTableShell } from "./TraceTableShell";

const SKELETON_ROW_COUNT = 18;
const TRACE_MIN_WIDTH = "1500px";
const NARROW_MIN_WIDTH = "880px";

const WIDTH_VARIANTS = ["38%", "55%", "72%", "46%", "82%", "60%"];

const widthFor = (rowIdx: number, colIdx: number): string =>
  WIDTH_VARIANTS[(rowIdx * 7 + colIdx * 11) % WIDTH_VARIANTS.length]!;

interface SkeletonBarProps {
  width: string;
  height?: string;
}

const SkeletonBar: React.FC<SkeletonBarProps> = ({
  width,
  height = "10px",
}) => (
  <Box width={width} height={height} borderRadius="full" bg="fg.muted/20" />
);

interface SkeletonShape {
  columns: Array<ColumnDef<unknown, any>>;
  minWidth: string;
}

function buildSkeletonShape(lens: LensConfig): SkeletonShape {
  const rowKind = rowKindForGrouping(lens.grouping);
  if (rowKind === "conversation") {
    return {
      columns: [
        conversationSelectColumnDef,
        ...buildConversationColumns(lens.columns),
      ] as Array<ColumnDef<unknown, any>>,
      minWidth: NARROW_MIN_WIDTH,
    };
  }
  if (rowKind === "group") {
    const groupBy = groupByForGrouping(lens.grouping) ?? "service";
    return {
      columns: [
        groupSelectColumnDef,
        ...buildGroupColumns(lens.columns, groupBy),
      ] as Array<ColumnDef<unknown, any>>,
      minWidth: NARROW_MIN_WIDTH,
    };
  }
  return {
    columns: [
      traceSelectColumnDef,
      ...buildTraceColumns(lens.columns),
    ] as Array<ColumnDef<unknown, any>>,
    minWidth: TRACE_MIN_WIDTH,
  };
}

export const TraceTableSkeleton: React.FC = () => {
  const tokens = useDensityTokens();
  const lens = useViewStore(
    (s) => s.allLenses.find((l) => l.id === s.activeLensId) ?? s.allLenses[0]!,
  );
  const { columns: columnDefs, minWidth } = buildSkeletonShape(lens);
  const isTraceLens = rowKindForGrouping(lens.grouping) === "trace";

  const table = useReactTable({
    data: [] as unknown[],
    columns: columnDefs,
    getCoreRowModel: getCoreRowModel(),
  });
  const columns = table.getVisibleLeafColumns();

  return (
    <Box
      height="full"
      overflow="hidden"
      position="relative"
      css={{
        maskImage:
          "linear-gradient(to bottom, black 0%, black 60%, transparent 100%)",
        WebkitMaskImage:
          "linear-gradient(to bottom, black 0%, black 60%, transparent 100%)",
      }}
    >
      <TraceTableShell
        table={table}
        minWidth={minWidth}
        stickyFirstColumn={isTraceLens}
      >
        {Array.from({ length: SKELETON_ROW_COUNT }).map((_, rowIdx) => (
          <Tr
            key={`skel-row-${rowIdx}`}
            borderBottomWidth="1px"
            borderBottomColor="border.muted/40"
          >
            {columns.map((col, i) => {
              const meta = col.columnDef.meta as ColumnMeta | undefined;
              const align = meta?.align ?? "left";
              const lines = Math.max(meta?.skeletonLines ?? 1, 1);
              const size = col.getSize();
              const isSticky = isTraceLens && i === 0;
              return (
                <Td
                  key={`skel-cell-${col.id}`}
                  width={meta?.flex ? undefined : `${size}px`}
                  minWidth={`${col.columnDef.minSize}px`}
                  textAlign={align}
                  padding={`${tokens.rowPaddingY} 8px`}
                  position={isSticky ? "sticky" : undefined}
                  left={isSticky ? 0 : undefined}
                  zIndex={isSticky ? 1 : undefined}
                  bg={isSticky ? "bg.surface" : undefined}
                >
                  <Flex
                    direction="column"
                    align={align === "right" ? "flex-end" : "flex-start"}
                    gap={lines > 1 ? "5px" : 0}
                  >
                    {Array.from({ length: lines }).map((_, lineIdx) => (
                      <SkeletonBar
                        key={lineIdx}
                        width={widthFor(rowIdx + lineIdx * 3, i)}
                        height={lineIdx === 0 ? "10px" : "7px"}
                      />
                    ))}
                  </Flex>
                </Td>
              );
            })}
          </Tr>
        ))}
      </TraceTableShell>
    </Box>
  );
};
