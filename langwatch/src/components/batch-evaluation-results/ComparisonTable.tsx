/**
 * ComparisonTable - Table component for comparing multiple evaluation runs
 *
 * Displays stacked values from different runs with colored indicators.
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
import { ExpandableDatasetCell } from "./ExpandableDatasetCell";
import { ColumnTypeIcon } from "~/components/shared/ColumnTypeIcon";
import type {
  BatchResultRow,
  BatchDatasetColumn,
  BatchTargetColumn,
  ComparisonRunData,
} from "./types";
import { DiffCell, type DiffValue } from "./DiffCell";
import { TableSkeleton } from "./TableSkeleton";
import { ROW_HEIGHT, calculateMinTableWidth, getTableStyles } from "./tableUtils";

type ComparisonTableProps = {
  /** Comparison data from multiple runs */
  comparisonData: ComparisonRunData[];
  /** Loading state */
  isLoading?: boolean;
  /** Hidden column names */
  hiddenColumns?: Set<string>;
  /** Disable virtualization (for tests) */
  disableVirtualization?: boolean;
};

/**
 * Row structure for comparison mode - contains data from multiple runs
 */
type ComparisonRow = {
  index: number;
  datasetEntries: Record<string, Record<string, unknown>>;
  targetsByRun: Record<string, Record<string, BatchResultRow["targets"][string]>>;
  runColors: Record<string, string>;
};

// Column helper for comparison rows
const comparisonColumnHelper = createColumnHelper<ComparisonRow>();

/**
 * Build columns for comparison mode
 */
const buildComparisonColumns = (
  comparisonData: ComparisonRunData[],
  hiddenColumns: Set<string>
) => {
  const columns = [];

  // Get a merged view of all columns from all runs
  const allDatasetColumns = new Map<string, BatchDatasetColumn>();
  const allTargetColumns = new Map<string, BatchTargetColumn>();

  for (const run of comparisonData) {
    if (!run.data) continue;
    for (const col of run.data.datasetColumns) {
      if (!allDatasetColumns.has(col.name)) {
        allDatasetColumns.set(col.name, col);
      }
    }
    for (const col of run.data.targetColumns) {
      if (!allTargetColumns.has(col.id)) {
        allTargetColumns.set(col.id, col);
      }
    }
  }

  // Row number column
  columns.push(
    comparisonColumnHelper.display({
      id: "rowNumber",
      header: "",
      size: 32,
      cell: ({ row }) => (
        <Text fontSize="12px" color="gray.500" textAlign="right" paddingRight={1}>
          {row.original.index + 1}
        </Text>
      ),
    })
  );

  // Dataset columns with diff values
  for (const [colName, col] of allDatasetColumns) {
    if (hiddenColumns.has(colName)) continue;

    columns.push(
      comparisonColumnHelper.accessor((row) => row.datasetEntries, {
        id: `dataset_${colName}`,
        header: () => (
          <HStack gap={1}>
            <ColumnTypeIcon type="string" />
            <Text fontSize="13px" fontWeight="medium">
              {colName}
            </Text>
          </HStack>
        ),
        size: 210,
        minSize: 150,
        cell: ({ row }) => {
          const values: DiffValue[] = comparisonData
            .filter((run) => run.data !== null)
            .map((run) => {
              const entry = row.original.datasetEntries[run.runId];
              const value = entry?.[colName];
              return {
                runId: run.runId,
                color: run.color,
                value: (
                  <ExpandableDatasetCell value={value} columnName={colName} />
                ),
              };
            });

          // If all values are the same, just show one (no diff needed)
          const uniqueValues = new Set(
            values.map((v) => {
              const entry = row.original.datasetEntries[v.runId];
              return JSON.stringify(entry?.[colName]);
            })
          );

          if (uniqueValues.size === 1 && values[0]) {
            return values[0].value;
          }

          return <DiffCell values={values} />;
        },
      })
    );
  }

  // Target columns with diff values
  for (const [targetId, targetCol] of allTargetColumns) {
    columns.push(
      comparisonColumnHelper.accessor((row) => row.targetsByRun, {
        id: `target_${targetId}`,
        header: () => (
          <Text fontSize="13px" fontWeight="medium">
            {targetCol.name}
          </Text>
        ),
        size: 300,
        minSize: 200,
        cell: ({ row }) => {
          const values: DiffValue[] = comparisonData
            .filter((run) => run.data !== null)
            .map((run) => {
              const targets = row.original.targetsByRun[run.runId];
              const targetOutput = targets?.[targetId];

              return {
                runId: run.runId,
                color: run.color,
                isLoading: run.isLoading,
                value: targetOutput ? (
                  <BatchTargetCell targetOutput={targetOutput} />
                ) : (
                  <Text fontSize="13px" color="gray.400">
                    -
                  </Text>
                ),
              };
            });

          return <DiffCell values={values} />;
        },
      })
    );
  }

  return columns;
};

/**
 * Transform comparison data into row format
 */
const buildComparisonRows = (
  comparisonData: ComparisonRunData[]
): ComparisonRow[] => {
  // Find the max row count across all runs
  const maxRows = Math.max(
    0,
    ...comparisonData
      .filter((run) => run.data !== null)
      .map((run) => run.data!.rows.length)
  );

  const rows: ComparisonRow[] = [];

  for (let i = 0; i < maxRows; i++) {
    const datasetEntries: Record<string, Record<string, unknown>> = {};
    const targetsByRun: Record<
      string,
      Record<string, BatchResultRow["targets"][string]>
    > = {};
    const runColors: Record<string, string> = {};

    for (const run of comparisonData) {
      if (!run.data) continue;
      runColors[run.runId] = run.color;

      const row = run.data.rows[i];
      if (row) {
        datasetEntries[run.runId] = row.datasetEntry;
        targetsByRun[run.runId] = row.targets;
      }
    }

    rows.push({
      index: i,
      datasetEntries,
      targetsByRun,
      runColors,
    });
  }

  return rows;
};

export function ComparisonTable({
  comparisonData,
  isLoading,
  hiddenColumns = new Set(),
  disableVirtualization = false,
}: ComparisonTableProps) {
  // Build columns for comparison mode
  const columns = useMemo(() => {
    return buildComparisonColumns(comparisonData, hiddenColumns);
  }, [comparisonData, hiddenColumns]);

  // Build comparison rows
  const comparisonRows = useMemo(() => {
    return buildComparisonRows(comparisonData);
  }, [comparisonData]);

  // Memoize getCoreRowModel to prevent React scheduling loops
  const coreRowModel = useMemo(() => getCoreRowModel(), []);

  // Create table instance
  const table = useReactTable({
    data: comparisonRows,
    columns,
    getCoreRowModel: coreRowModel,
  });

  // State for scroll container - using state triggers re-render when mounted
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(
    null
  );

  // Callback ref to set the scroll container
  const scrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    setScrollContainer(node);
  }, []);

  // Get row count from source data to avoid React scheduling loops
  const rowCount = comparisonRows.length;

  // Stable callbacks for virtualizer
  const getScrollElement = useCallback(
    () => scrollContainer,
    [scrollContainer]
  );
  const estimateSize = useCallback(() => ROW_HEIGHT, []);

  // Set up row virtualization
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
  if (comparisonRows.length === 0) {
    return (
      <Box padding={6} textAlign="center">
        <Text color="gray.500">No results to display</Text>
      </Box>
    );
  }

  // Calculate minimum table width from first run with data
  const firstRunWithData = comparisonData.find((run) => run.data !== null);
  const datasetColCount =
    firstRunWithData?.data?.datasetColumns.filter(
      (c) => !hiddenColumns.has(c.name)
    ).length ?? 0;
  const targetColCount = firstRunWithData?.data?.targetColumns.length ?? 0;
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
                <th key={header.id} style={{ width: header.getSize() }}>
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
