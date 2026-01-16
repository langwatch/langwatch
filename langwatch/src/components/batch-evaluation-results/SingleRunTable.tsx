/**
 * SingleRunTable - Table component for displaying a single evaluation run
 *
 * Displays dataset columns followed by target columns with inline evaluator chips.
 * Target headers include summary statistics.
 */
import { useMemo, useState, useCallback } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Box, HStack, Text } from "@chakra-ui/react";

import { BatchTargetCell } from "./BatchTargetCell";
import { BatchTargetHeader } from "./BatchTargetHeader";
import { ExpandableDatasetCell } from "./ExpandableDatasetCell";
import { ColumnTypeIcon } from "~/components/shared/ColumnTypeIcon";
import { ExternalImage, getImageUrl } from "~/components/ExternalImage";
import {
  computeAllBatchAggregates,
  type BatchTargetAggregate,
} from "./computeBatchAggregates";
import type {
  BatchEvaluationData,
  BatchResultRow,
  BatchDatasetColumn,
  BatchTargetColumn,
} from "./types";
import { TableSkeleton } from "./TableSkeleton";
import {
  ROW_HEIGHT,
  calculateMinTableWidth,
  getTableStyles,
  inferColumnType,
} from "./tableUtils";

type SingleRunTableProps = {
  /** Transformed batch evaluation data */
  data: BatchEvaluationData | null;
  /** Loading state */
  isLoading?: boolean;
  /** Hidden column names */
  hiddenColumns?: Set<string>;
  /** Target colors for when X-axis is "target" in charts */
  targetColors?: Record<string, string>;
  /** Disable virtualization (for tests) */
  disableVirtualization?: boolean;
};

// Column helper for type-safe column definitions
const columnHelper = createColumnHelper<BatchResultRow>();

/**
 * Build columns for single run mode
 */
const buildColumns = (
  datasetColumns: BatchDatasetColumn[],
  targetColumns: BatchTargetColumn[],
  aggregatesMap: Map<string, BatchTargetAggregate>,
  rows: BatchResultRow[],
  hiddenColumns: Set<string>,
  targetColors?: Record<string, string>
) => {
  const columns = [];

  // Row number column
  columns.push(
    columnHelper.display({
      id: "rowNumber",
      header: "",
      size: 32,
      cell: ({ row }) => (
        <Text fontSize="12px" color="gray.500" textAlign="right" paddingRight={1}>
          {row.index + 1}
        </Text>
      ),
    })
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

          // Check for image - only if column is marked as having images
          if (col.hasImages && typeof value === "string") {
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
          return <ExpandableDatasetCell value={value} columnName={col.name} />;
        },
      })
    );
  }

  // Target columns with headers that include summary
  for (const targetCol of targetColumns) {
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
        cell: ({ getValue }) => {
          const targetOutput = getValue();
          if (!targetOutput) {
            return (
              <Text fontSize="13px" color="gray.400">
                -
              </Text>
            );
          }
          return <BatchTargetCell targetOutput={targetOutput} />;
        },
      })
    );
  }

  return columns;
};

export function SingleRunTable({
  data,
  isLoading,
  hiddenColumns = new Set(),
  targetColors = {},
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
    return buildColumns(
      data.datasetColumns,
      data.targetColumns,
      aggregatesMap,
      data.rows,
      hiddenColumns,
      showTargetColors ? targetColors : undefined
    );
  }, [data, aggregatesMap, hiddenColumns, showTargetColors, targetColors]);

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
  const estimateSize = useCallback(() => ROW_HEIGHT, []);

  // TEMPORARILY DISABLED: Testing if virtualization causes scroll/flicker issues
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement,
    estimateSize,
    overscan: 5,
    enabled: !!scrollContainer,
  });

  // Loading state
  if (isLoading) {
    return <TableSkeleton />;
  }

  // Empty state
  if (!data || data.rows.length === 0) {
    return (
      <Box padding={6} textAlign="center">
        <Text color="gray.500">No results to display</Text>
      </Box>
    );
  }

  // Calculate minimum table width
  const datasetColCount = data.datasetColumns.filter(
    (c) => !hiddenColumns.has(c.name)
  ).length;
  const targetColCount = data.targetColumns.length;
  const minTableWidth = calculateMinTableWidth(datasetColCount, targetColCount);

  const tableStyles = getTableStyles(minTableWidth);
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const rows = table.getRowModel().rows;
  const columnCount = table.getAllColumns().length;

  // Calculate padding to maintain scroll position (only when virtualizing)
  const paddingTop =
    virtualRows.length > 0 ? virtualRows[0]?.start ?? 0 : 0;
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
                    : flexRender(
                        header.column.columnDef.header,
                        header.getContext()
                      )}
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
                  <tr key={row.id} data-index={virtualRow.index}>
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
