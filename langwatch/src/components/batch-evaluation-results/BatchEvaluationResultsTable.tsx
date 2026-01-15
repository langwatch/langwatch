/**
 * BatchEvaluationResultsTable - Main table component for batch evaluation results
 *
 * Uses TanStack Table for performance and consistency with Evaluations V3.
 * Displays dataset columns followed by target columns with inline evaluator chips.
 * Target headers include summary statistics similar to V3.
 */
import { useMemo, useRef, useState, useCallback } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Box,
  Button,
  HStack,
  Text,
} from "@chakra-ui/react";
import { Columns3 } from "lucide-react";
import { Checkbox } from "~/components/ui/checkbox";
import {
  PopoverArrow,
  PopoverBody,
  PopoverContent,
  PopoverRoot,
  PopoverTrigger,
} from "~/components/ui/popover";

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
  ComparisonRunData,
} from "./types";
import { DiffCell, type DiffValue } from "./DiffCell";
import { TableSkeleton } from "./TableSkeleton";

type BatchEvaluationResultsTableProps = {
  /** Transformed batch evaluation data (single run mode) */
  data: BatchEvaluationData | null;
  /** Loading state */
  isLoading?: boolean;
  /** Hidden column names (controlled from parent) */
  hiddenColumns?: Set<string>;
  /** Callback when column visibility changes */
  onToggleColumn?: (columnName: string) => void;
  /** Comparison mode: multiple runs to display side by side */
  comparisonData?: ComparisonRunData[] | null;
  /** Target colors for when X-axis is "target" in charts */
  targetColors?: Record<string, string>;
};

/**
 * Columns that should be hidden by default
 * Typically metadata columns like "id" that users rarely need to see
 */
export const DEFAULT_HIDDEN_COLUMNS = new Set(["id", "_id", "ID", "Id"]);

/**
 * Column visibility toggle button with popover menu
 * Exported for use in page header
 */
export type ColumnVisibilityButtonProps = {
  datasetColumns: BatchDatasetColumn[];
  hiddenColumns: Set<string>;
  onToggle: (columnName: string) => void;
};

export const ColumnVisibilityButton = ({
  datasetColumns,
  hiddenColumns,
  onToggle,
}: ColumnVisibilityButtonProps) => {
  return (
    <PopoverRoot>
      <PopoverTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          aria-label="Toggle column visibility"
        >
          <Columns3 size={16} />
          Columns
        </Button>
      </PopoverTrigger>
      <PopoverContent width="200px">
        <PopoverArrow />
        <PopoverBody padding={2}>
          <Text fontSize="12px" fontWeight="semibold" color="gray.600" marginBottom={2}>
            Show columns
          </Text>
          {datasetColumns.map((col) => (
            <HStack
              key={col.name}
              gap={2}
              paddingY={1}
              paddingX={1}
              borderRadius="sm"
              cursor="pointer"
              _hover={{ background: "gray.50" }}
              onClick={() => onToggle(col.name)}
            >
              <Checkbox
                size="sm"
                checked={!hiddenColumns.has(col.name)}
                // Don't add onCheckedChange - the HStack onClick handles it
                // Adding both causes double toggle
              />
              <Text fontSize="13px">{col.name}</Text>
            </HStack>
          ))}
        </PopoverBody>
      </PopoverContent>
    </PopoverRoot>
  );
};

/**
 * Row type for comparison mode - contains data from multiple runs
 */
type ComparisonRow = {
  index: number;
  /** Dataset entries from each run keyed by runId */
  datasetEntries: Record<string, Record<string, unknown>>;
  /** Targets from each run keyed by runId */
  targetsByRun: Record<string, Record<string, BatchResultRow["targets"][string]>>;
  /** Run colors by runId for display */
  runColors: Record<string, string>;
};

const columnHelper = createColumnHelper<BatchResultRow>();
const comparisonColumnHelper = createColumnHelper<ComparisonRow>();

// Stringify value for display
const stringify = (value: unknown): string => {
  if (value === null || value === undefined) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
};

/**
 * Infer column type from value.
 * Used when explicit type is not available.
 */
const inferColumnType = (value: unknown): string => {
  if (value === null || value === undefined) return "string";
  if (typeof value === "number") return "number";
  if (typeof value === "object") {
    // Check for chat messages format
    // Must verify first element is actually an object before using 'in' operator
    if (
      Array.isArray(value) &&
      value.length > 0 &&
      typeof value[0] === "object" &&
      value[0] !== null &&
      "role" in value[0]
    ) {
      return "chat_messages";
    }
    return "json";
  }
  return "string";
};

/**
 * Build column definitions for the table
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

  // Row number column (compact)
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

/**
 * Build comparison mode columns - shows stacked values from multiple runs
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
      comparisonColumnHelper.accessor(
        (row) => row.datasetEntries,
        {
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
                  value: <ExpandableDatasetCell value={value} columnName={colName} />,
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
        }
      )
    );
  }

  // Target columns with diff values
  for (const [targetId, targetCol] of allTargetColumns) {
    columns.push(
      comparisonColumnHelper.accessor(
        (row) => row.targetsByRun,
        {
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
                    <Text fontSize="13px" color="gray.400">-</Text>
                  ),
                };
              });

            return <DiffCell values={values} />;
          },
        }
      )
    );
  }

  return columns;
};

/**
 * Transform comparison data into row format
 */
const buildComparisonRows = (comparisonData: ComparisonRunData[]): ComparisonRow[] => {
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
    const targetsByRun: Record<string, Record<string, BatchResultRow["targets"][string]>> = {};
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

export function BatchEvaluationResultsTable({
  data,
  isLoading,
  hiddenColumns: externalHiddenColumns,
  onToggleColumn,
  comparisonData,
  targetColors = {},
}: BatchEvaluationResultsTableProps) {
  // Use external or internal hidden columns state
  const hiddenColumns = externalHiddenColumns ?? new Set<string>();

  // Determine if we're in comparison mode
  const isComparisonMode = !!comparisonData && comparisonData.length > 1;

  // Check if target colors should be shown (non-empty means X-axis is "target")
  const showTargetColors = Object.keys(targetColors).length > 0;

  // Compute aggregates for all targets (single run mode only)
  const aggregatesMap = useMemo(() => {
    if (isComparisonMode || !data) return new Map<string, BatchTargetAggregate>();
    return computeAllBatchAggregates(data);
  }, [data, isComparisonMode]);

  // Build columns from data (single run mode)
  const singleRunColumns = useMemo(() => {
    if (isComparisonMode || !data) return [];
    return buildColumns(
      data.datasetColumns,
      data.targetColumns,
      aggregatesMap,
      data.rows,
      hiddenColumns,
      showTargetColors ? targetColors : undefined
    );
  }, [data, aggregatesMap, hiddenColumns, isComparisonMode, showTargetColors, targetColors]);

  // Build columns for comparison mode
  const comparisonColumns = useMemo(() => {
    if (!isComparisonMode || !comparisonData) return [];
    return buildComparisonColumns(comparisonData, hiddenColumns);
  }, [comparisonData, hiddenColumns, isComparisonMode]);

  // Build comparison rows
  const comparisonRows = useMemo(() => {
    if (!isComparisonMode || !comparisonData) return [];
    return buildComparisonRows(comparisonData);
  }, [comparisonData, isComparisonMode]);

  // Memoize getCoreRowModel to prevent infinite re-renders
  // TanStack Table can cause React scheduling loops if options change on every render
  const coreRowModel = useMemo(() => getCoreRowModel(), []);

  // Create table instance for single run mode
  const singleRunTable = useReactTable({
    data: data?.rows ?? [],
    columns: singleRunColumns,
    getCoreRowModel: coreRowModel,
  });

  // Create table instance for comparison mode
  const comparisonTable = useReactTable({
    data: comparisonRows,
    columns: comparisonColumns,
    getCoreRowModel: coreRowModel,
  });

  // State for scroll container - using state instead of ref triggers re-render when mounted
  // This is important because useVirtualizer needs to know when the scroll element is available
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);

  // Callback ref to set the scroll container
  const scrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    setScrollContainer(node);
  }, []);

  // Estimated row height for virtualization
  const ROW_HEIGHT = 80;

  // Get row count based on mode
  // Note: We use the source data length directly instead of getRowModel().rows.length
  // because calling getRowModel() during render can cause React scheduling loops
  // in certain contexts (optimization studio, wizard) due to TanStack Table internals
  const rowCount = isComparisonMode
    ? comparisonRows.length
    : (data?.rows?.length ?? 0);

  // Stable callbacks for virtualizer to prevent unnecessary recalculations
  const getScrollElement = useCallback(() => scrollContainer, [scrollContainer]);
  const estimateSize = useCallback(() => ROW_HEIGHT, []);

  // Set up row virtualization
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement,
    estimateSize,
    overscan: 5, // Render 5 extra rows above/below viewport for smooth scrolling
    enabled: !!scrollContainer, // Only enable when scroll container is mounted
  });

  // Loading state - render a skeleton that looks like the actual table
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

  // Calculate minimum table width based on columns
  // Row number (40) + dataset cols (210 each) + target cols (300 each)
  const datasetColCount = data.datasetColumns.filter(c => !hiddenColumns.has(c.name)).length;
  const targetColCount = data.targetColumns.length;
  const minTableWidth = 40 + (datasetColCount * 210) + (targetColCount * 300);

  // Table styling shared between modes
  const tableStyles = {
    "& table": {
      width: "100%",
      minWidth: `${minTableWidth}px`,
      borderCollapse: "collapse",
    },
    "& th": {
      position: "sticky",
      top: 0,
      background: "white",
      borderBottom: "1px solid var(--chakra-colors-gray-200)",
      padding: "8px 12px",
      textAlign: "left",
      fontSize: "12px",
      fontWeight: "600",
      color: "var(--chakra-colors-gray-600)",
      whiteSpace: "nowrap",
      zIndex: 1,
    },
    "& td": {
      borderBottom: "1px solid var(--chakra-colors-gray-100)",
      padding: "12px",
      verticalAlign: "top",
      fontSize: "13px",
    },
    // First column (row number) should stay small
    "& td:first-of-type": {
      minWidth: "40px",
      width: "40px",
    },
    "& tr:hover td": {
      background: "var(--chakra-colors-gray-50)",
    },
    "& td:hover .cell-action-btn": {
      opacity: 1,
    },
  } as const;

  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  // Calculate padding to maintain scroll position
  const paddingTop = virtualRows.length > 0 ? virtualRows[0]?.start ?? 0 : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0;

  // Render comparison mode table
  if (isComparisonMode) {
    const rows = comparisonTable.getRowModel().rows;
    const columnCount = comparisonTable.getAllColumns().length;

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
            {comparisonTable.getHeaderGroups().map((headerGroup) => (
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
            {/* Top padding row to maintain scroll position */}
            {paddingTop > 0 && (
              <tr>
                <td style={{ height: `${paddingTop}px`, padding: 0 }} colSpan={columnCount} />
              </tr>
            )}
            {/* Render only visible rows */}
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
                <td style={{ height: `${paddingBottom}px`, padding: 0 }} colSpan={columnCount} />
              </tr>
            )}
          </tbody>
        </table>
      </Box>
    );
  }

  // Render single run mode table
  const rows = singleRunTable.getRowModel().rows;
  const columnCount = singleRunTable.getAllColumns().length;

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
          {singleRunTable.getHeaderGroups().map((headerGroup) => (
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
          {/* Top padding row to maintain scroll position */}
          {paddingTop > 0 && (
            <tr>
              <td style={{ height: `${paddingTop}px`, padding: 0 }} colSpan={columnCount} />
            </tr>
          )}
          {/* Render only visible rows */}
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
              <td style={{ height: `${paddingBottom}px`, padding: 0 }} colSpan={columnCount} />
            </tr>
          )}
        </tbody>
      </table>
    </Box>
  );
}
