/**
 * BatchEvaluationResultsTable - Main table component for batch evaluation results
 *
 * Uses TanStack Table for performance and consistency with Evaluations V3.
 * Displays dataset columns followed by target columns with inline evaluator chips.
 * Target headers include summary statistics similar to V3.
 */
import { useMemo } from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Box, HStack, Skeleton, Text, VStack } from "@chakra-ui/react";

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

type BatchEvaluationResultsTableProps = {
  /** Transformed batch evaluation data */
  data: BatchEvaluationData | null;
  /** Loading state */
  isLoading?: boolean;
};

const columnHelper = createColumnHelper<BatchResultRow>();

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
    if (Array.isArray(value) && value.length > 0 && "role" in (value[0] as object)) {
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
  rows: BatchResultRow[]
) => {
  const columns = [];

  // Row number column (narrow, no header text)
  columns.push(
    columnHelper.display({
      id: "rowNumber",
      header: "",
      size: 36,
      cell: ({ row }) => (
        <Text fontSize="12px" color="gray.500" textAlign="center">
          {row.index + 1}
        </Text>
      ),
    })
  );

  // Dataset columns with type icons
  for (const col of datasetColumns) {
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
        size: 150,
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

    columns.push(
      columnHelper.accessor((row) => row.targets[targetCol.id], {
        id: `target_${targetCol.id}`,
        header: () => (
          <BatchTargetHeader target={targetCol} aggregates={aggregates} />
        ),
        size: 280,
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

export function BatchEvaluationResultsTable({
  data,
  isLoading,
}: BatchEvaluationResultsTableProps) {
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
      data.rows
    );
  }, [data, aggregatesMap]);

  // Create table instance
  const table = useReactTable({
    data: data?.rows ?? [],
    columns,
    getCoreRowModel: getCoreRowModel(),
  });

  // Loading state - render a skeleton that looks like the actual table
  if (isLoading) {
    return (
      <Box
        overflowX="auto"
        css={{
          "& table": { width: "100%", borderCollapse: "collapse" },
          "& th": {
            borderBottom: "1px solid var(--chakra-colors-gray-200)",
            padding: "8px 12px",
            textAlign: "left",
          },
          "& td": {
            borderBottom: "1px solid var(--chakra-colors-gray-100)",
            padding: "12px",
          },
        }}
      >
        <table>
          <thead>
            <tr>
              <th style={{ width: 36 }} />
              <th style={{ width: 150 }}><Skeleton height="16px" width="80px" /></th>
              <th style={{ width: 150 }}><Skeleton height="16px" width="100px" /></th>
              <th style={{ width: 280 }}><Skeleton height="16px" width="120px" /></th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, rowIdx) => (
              <tr key={rowIdx}>
                <td style={{ width: 36 }}><Skeleton height="14px" width="20px" /></td>
                <td style={{ width: 150 }}><Skeleton height="40px" /></td>
                <td style={{ width: 150 }}><Skeleton height="40px" /></td>
                <td style={{ width: 280 }}><Skeleton height="60px" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    );
  }

  // Empty state
  if (!data || data.rows.length === 0) {
    return (
      <Box padding={6} textAlign="center">
        <Text color="gray.500">No results to display</Text>
      </Box>
    );
  }

  return (
    <Box
      overflowX="auto"
      overflowY="auto"
      maxHeight="calc(100vh - 300px)"
      css={{
        // Table styling
        "& table": {
          width: "100%",
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
        "& tr:hover td": {
          background: "var(--chakra-colors-gray-50)",
        },
        // Cell action buttons appear on hover
        "& td:hover .cell-action-btn": {
          opacity: 1,
        },
      }}
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
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <td key={cell.id} style={{ width: cell.column.getSize() }}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Box>
  );
}
