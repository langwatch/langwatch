/**
 * SingleRunTable - Table component for displaying a single evaluation run
 *
 * Displays dataset columns followed by target columns with inline evaluator chips.
 * Target headers include summary statistics.
 */

import { Box, HStack, Text } from "@chakra-ui/react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Swords } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { ExternalImage, getImageUrl } from "~/components/ExternalImage";
import { ColumnTypeIcon } from "@langwatch/design-system/column-type-icon";
import { BatchTargetCell } from "./BatchTargetCell";
import { BatchTargetHeader } from "./BatchTargetHeader";
import { ComparisonWinnerCell } from "./ComparisonWinnerCell";
import {
  type BatchTargetAggregate,
  computeAllBatchAggregates,
} from "@langwatch/experiment-web";
import { ExpandableDatasetCell } from "./ExpandableDatasetCell";
import { TableSkeleton } from "./TableSkeleton";
import {
  calculateMinTableWidth,
  DEFAULT_ROW_HEIGHT,
  ESTIMATED_ROW_HEIGHT_PX,
  getTableStyles,
  inferColumnType,
  type RowHeight,
} from "./tableUtils";
import type {
  BatchComparisonColumn,
  BatchDatasetColumn,
  BatchEvaluationData,
  BatchResultRow,
  BatchTargetColumn,
} from "@langwatch/experiment-web";

type SingleRunTableProps = {
  /** Transformed batch evaluation data */
  data: BatchEvaluationData | null;
  /** Loading state */
  isLoading?: boolean;
  /** Hidden column names */
  hiddenColumns?: Set<string>;
  /** Target colors for when X-axis is "target" in charts */
  targetColors?: Record<string, string>;
  /** Whether to render target output values (default true) */
  showOutputs?: boolean;
  /** Whether to render evaluator score chips (default true) */
  showEvaluations?: boolean;
  /** Whether to render the cost/latency readout (default true) */
  showCostAndLatency?: boolean;
  /** How much of each cell's collapsed content to show (default "m") */
  rowHeight?: RowHeight;
  /** Disable virtualization (for tests) */
  disableVirtualization?: boolean;
};

// Column helper for type-safe column definitions
const columnHelper = createColumnHelper<BatchResultRow>();

type BuildColumnsOptions = {
  datasetColumns: BatchDatasetColumn[];
  targetColumns: BatchTargetColumn[];
  comparisonColumns: BatchComparisonColumn[];
  aggregatesMap: Map<string, BatchTargetAggregate>;
  rows: BatchResultRow[];
  hiddenColumns: Set<string>;
  showOutputs: boolean;
  showEvaluations: boolean;
  showCostAndLatency: boolean;
  rowHeight: RowHeight;
  targetColors?: Record<string, string>;
};

/**
 * Build columns for single run mode
 */
const buildColumns = ({
  datasetColumns,
  targetColumns,
  comparisonColumns,
  aggregatesMap,
  rows,
  hiddenColumns,
  showOutputs,
  showEvaluations,
  showCostAndLatency,
  rowHeight,
  targetColors,
}: BuildColumnsOptions) => {
  // Evaluator ids whose per-row chip is redundant with the dedicated Winner
  // column below — the generic `EvaluatorResultChip` renders the comparison
  // verdict as `<target_XYZ> 1.00`, which reads as noise to users (dogfood
  // report). Suppressing them in the target cell keeps the Winner column
  // the single source of the comparison result.
  const comparisonEvaluatorIds = new Set(comparisonColumns.map((p) => p.evaluatorId));
  const columns = [];

  // Row number column
  columns.push(
    columnHelper.display({
      id: "rowNumber",
      header: "",
      size: 32,
      cell: ({ row }) => (
        <Text fontSize="12px" color="fg.muted" textAlign="right" paddingRight={1}>
          {row.index + 1}
        </Text>
      ),
    }),
  );

  // Dataset columns with type icons (skip hidden columns)
  for (const col of datasetColumns) {
    if (hiddenColumns.has(col.name)) continue;

    // Infer column type from first non-null value
    let columnType = "string";
    for (const row of rows) {
      const value = row.datasetEntry[col.name];
      if (value !== null && value !== undefined) {
        columnType = inferColumnType(value);
        break;
      }
    }

    columns.push(
      columnHelper.accessor((row) => row.datasetEntry[col.name], {
        id: `dataset_${col.name}`,
        header: () => (
          <HStack gap={1}>
            <ColumnTypeIcon type={columnType} />
            <Text fontSize="13px" fontWeight="medium">
              {col.name}
            </Text>
          </HStack>
        ),
        size: 210,
        minSize: 150,
        cell: ({ getValue }) => {
          const value = getValue();

          // Check each cell for image URLs regardless of column type
          if (typeof value === "string") {
            const imageUrl = getImageUrl(value);
            if (imageUrl) {
              return (
                <ExternalImage
                  src={imageUrl}
                  minWidth="24px"
                  minHeight="24px"
                  maxHeight="80px"
                  maxWidth="100%"
                  expandable
                />
              );
            }
          }

          // Use expandable cell for text content
          return (
            <ExpandableDatasetCell
              value={value}
              columnName={col.name}
              rowHeight={rowHeight}
            />
          );
        },
      }),
    );
  }

  // Map each comparison column-target to its detected metadata so we
  // can render the winner cell (badge + winning output + reasoning) INSIDE
  // the comparison column's own cell — the user wants everything in one
  // place, not split across a target column and a trailing Winner column.
  const comparisonByTargetId = new Map(comparisonColumns.map((p) => [p.evaluatorId, p]));

  // Target columns with headers that include summary.
  // Skip a column entirely when no target field is shown — unless it hosts
  // a comparison verdict (Winner cell), which is independent of the field
  // toggles and would otherwise vanish along with them, silently dropping
  // the comparison result.
  const showTargetColumns = showOutputs || showEvaluations || showCostAndLatency;
  for (const targetCol of targetColumns) {
    const comparisonMeta = comparisonByTargetId.get(targetCol.id);
    if (!showTargetColumns && !comparisonMeta) continue;
    const aggregates = aggregatesMap.get(targetCol.id) ?? null;
    const targetColor = targetColors?.[targetCol.id];

    columns.push(
      columnHelper.accessor((row) => row.targets[targetCol.id], {
        id: `target_${targetCol.id}`,
        header: () => (
          <BatchTargetHeader
            target={targetCol}
            aggregates={aggregates}
            colorIndicator={targetColor}
          />
        ),
        size: 300,
        minSize: 200,
        cell: ({ getValue, row }) => {
          const targetOutput = getValue();
          // Comparison column-target cell: render the dedicated Winner cell
          // (badge + winning output + reasoning) instead of the generic
          // target output. That keeps everything the reader wants in one
          // column so they don't need to scroll to a trailing Winner column.
          if (comparisonMeta) {
            return (
              <ComparisonWinnerCell
                column={comparisonMeta}
                verdict={comparisonMeta.verdictsByRow[row.original.index]}
                targetColors={targetColors}
              />
            );
          }
          if (!targetOutput) {
            return (
              <Text fontSize="13px" color="fg.subtle">
                -
              </Text>
            );
          }
          return (
            <BatchTargetCell
              targetOutput={targetOutput}
              suppressedEvaluatorIds={comparisonEvaluatorIds}
              showOutput={showOutputs}
              showEvaluations={showEvaluations}
              showCostAndLatency={showCostAndLatency}
              rowHeight={rowHeight}
            />
          );
        },
      }),
    );
  }

  // A comparison wired as an evaluator chip rather than as its own column has
  // no target column to render its verdict inside, and its chip is suppressed
  // above. Without a trailing Winner column the verdict would be invisible.
  for (const column of trailingComparisonColumns(comparisonColumns, targetColumns)) {
    columns.push(
      columnHelper.display({
        id: `comparison_${column.evaluatorId}`,
        header: () => (
          <HStack gap={1.5}>
            <Swords size={14} />
            <Text fontSize="12px" fontWeight="600">
              {column.name}
            </Text>
          </HStack>
        ),
        size: 240,
        minSize: 200,
        cell: ({ row }) => (
          <ComparisonWinnerCell
            column={column}
            verdict={column.verdictsByRow[row.original.index]}
            targetColors={targetColors}
          />
        ),
      }),
    );
  }

  return columns;
};

/**
 * Comparison columns that need a Winner column of their own — i.e. those that
 * are not already rendered inside a matching target column.
 */
export const trailingComparisonColumns = (
  comparisonColumns: BatchComparisonColumn[],
  targetColumns: BatchTargetColumn[],
): BatchComparisonColumn[] => {
  const targetIds = new Set(targetColumns.map((t) => t.id));
  return comparisonColumns.filter((c) => !targetIds.has(c.evaluatorId));
};

export function SingleRunTable({
  data,
  isLoading,
  hiddenColumns = new Set(),
  targetColors = {},
  showOutputs = true,
  showEvaluations = true,
  showCostAndLatency = true,
  rowHeight = DEFAULT_ROW_HEIGHT,
  disableVirtualization = false,
}: SingleRunTableProps) {
  // Check if target colors should be shown (non-empty means X-axis is "target")
  const showTargetColors = Object.keys(targetColors).length > 0;

  // Compute aggregates for all targets
  const aggregatesMap = useMemo(() => {
    if (!data) return new Map<string, BatchTargetAggregate>();
    return computeAllBatchAggregates(data);
  }, [data]);

  // Build columns from data
  const columns = useMemo(() => {
    if (!data) return [];
    return buildColumns({
      datasetColumns: data.datasetColumns,
      targetColumns: data.targetColumns,
      comparisonColumns: data.comparisonColumns ?? [],
      aggregatesMap,
      rows: data.rows,
      hiddenColumns,
      showOutputs,
      showEvaluations,
      showCostAndLatency,
      rowHeight,
      targetColors: showTargetColors ? targetColors : undefined,
    });
  }, [
    data,
    aggregatesMap,
    hiddenColumns,
    showOutputs,
    showEvaluations,
    showCostAndLatency,
    rowHeight,
    showTargetColors,
    targetColors,
  ]);

  // Memoize getCoreRowModel to prevent React scheduling loops
  const coreRowModel = useMemo(() => getCoreRowModel(), []);

  // Create table instance
  const table = useReactTable({
    data: data?.rows ?? [],
    columns,
    getCoreRowModel: coreRowModel,
  });

  // State for scroll container - using state triggers re-render when mounted
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);

  // Callback ref to set the scroll container
  const scrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    setScrollContainer(node);
  }, []);

  // Get row count from source data to avoid React scheduling loops
  const rowCount = data?.rows?.length ?? 0;
  // const rowCount = table.getRowModel().rows.length;

  // Stable callbacks for virtualizer
  const getScrollElement = useCallback(() => scrollContainer, [scrollContainer]);
  const estimatedRowHeight = ESTIMATED_ROW_HEIGHT_PX[rowHeight];
  const estimateSize = useCallback(() => estimatedRowHeight, [estimatedRowHeight]);

  // Set up row virtualization with dynamic measurement
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement,
    estimateSize,
    overscan: 10,
    enabled: !!scrollContainer,
    // Enable dynamic measurement - measures actual row heights as they render
    measureElement:
      typeof window !== "undefined"
        ? (element) => element?.getBoundingClientRect().height ?? estimatedRowHeight
        : undefined,
  });

  // Loading state
  if (isLoading) {
    return <TableSkeleton />;
  }

  // Empty state
  if (!data || data.rows.length === 0) {
    return (
      <Box padding={6} textAlign="center">
        <Text color="fg.muted">No results to display</Text>
      </Box>
    );
  }

  // Calculate minimum table width
  const datasetColCount = data.datasetColumns.filter(
    (c) => !hiddenColumns.has(c.name),
  ).length;
  // Target columns that don't host a comparison verdict collapse away when
  // both output/evaluation sections are hidden — see the matching skip in
  // buildColumns above.
  const comparisonTargetIds = new Set(
    (data.comparisonColumns ?? []).map((p) => p.evaluatorId),
  );
  const showTargetColumns = showOutputs || showEvaluations || showCostAndLatency;
  const targetColCount = showTargetColumns
    ? data.targetColumns.length
    : data.targetColumns.filter((t) => comparisonTargetIds.has(t.id)).length;
  // Only the comparisons that get their own trailing column add width; one
  // rendered inside a target column is already paid for by that column.
  const comparisonColCount = trailingComparisonColumns(
    data.comparisonColumns ?? [],
    data.targetColumns,
  ).length;
  const minTableWidth = calculateMinTableWidth(
    datasetColCount,
    targetColCount,
    comparisonColCount,
  );

  const tableStyles = getTableStyles(minTableWidth);
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const rows = table.getRowModel().rows;
  const columnCount = table.getAllColumns().length;

  // Calculate padding to maintain scroll position (only when virtualizing)
  const paddingTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0;

  return (
    <Box
      ref={scrollContainerRef}
      overflowX="auto"
      overflowY="auto"
      width="100%"
      height="100%"
      css={tableStyles}
    >
      <table>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th key={header.id} style={{ width: `${header.getSize()}px` }}>
                  {header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext())}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {disableVirtualization ? (
            // Test mode: render all rows without virtualization
            rows.map((row) => (
              <tr key={row.id} data-index={row.index}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} style={{ width: cell.column.getSize() }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))
          ) : (
            <>
              {/* Top padding row to maintain scroll position */}
              {paddingTop > 0 && (
                <tr>
                  <td
                    style={{ height: `${paddingTop}px`, padding: 0 }}
                    colSpan={columnCount}
                  />
                </tr>
              )}
              {/* Render only virtualized rows - empty until container is measured */}
              {virtualRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                if (!row) return null;
                return (
                  <tr
                    key={row.id}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} style={{ width: cell.column.getSize() }}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                );
              })}
              {/* Bottom padding row to maintain scroll position */}
              {paddingBottom > 0 && (
                <tr>
                  <td
                    style={{ height: `${paddingBottom}px`, padding: 0 }}
                    colSpan={columnCount}
                  />
                </tr>
              )}
            </>
          )}
        </tbody>
      </table>
    </Box>
  );
}
