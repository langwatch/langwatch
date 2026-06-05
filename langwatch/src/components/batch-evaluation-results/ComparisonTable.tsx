/**
 * ComparisonTable - Table component for comparing multiple evaluation runs.
 *
 * Displays stacked per-run values with colored indicators. Optionally
 * groups rows under collapsible headers keyed on a dataset-entry
 * metadata field (issue #4632).
 */

import { Box, Button, HStack, Portal, Spacer, Text, VStack } from "@chakra-ui/react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useMemo, useRef, useState } from "react";
import { ColumnTypeIcon } from "~/components/shared/ColumnTypeIcon";
import { BatchTargetCell } from "./BatchTargetCell";
import { DiffCell, type DiffValue } from "./DiffCell";
import { ExpandableDatasetCell } from "./ExpandableDatasetCell";
import { TableSkeleton } from "./TableSkeleton";
import {
  calculateMinTableWidth,
  getTableStyles,
  ROW_HEIGHT,
} from "./tableUtils";
import type {
  BatchDatasetColumn,
  BatchResultRow,
  BatchTargetColumn,
  ComparisonRunData,
} from "./types";
import { useResultsGrouping } from "./useResultsGrouping";

type ComparisonTableProps = {
  /** Comparison data from multiple runs */
  comparisonData: ComparisonRunData[];
  /** Loading state */
  isLoading?: boolean;
  /** Hidden column names */
  hiddenColumns?: Set<string>;
  /** Disable virtualization (for tests) */
  disableVirtualization?: boolean;
  /**
   * Group rows by this dataset-entry metadata key. `null`/undefined =
   * flat (no grouping). Controlled when provided; otherwise the
   * component manages its own local selection (no URL sync).
   */
  groupBy?: string | null;
  /** Callback when the user picks a different grouping key. */
  onGroupByChange?: (key: string | null) => void;
};

/**
 * Row structure for comparison mode - contains data from multiple runs
 */
type ComparisonRow = {
  index: number;
  datasetEntries: Record<string, Record<string, unknown>>;
  targetsByRun: Record<
    string,
    Record<string, BatchResultRow["targets"][string]>
  >;
  runColors: Record<string, string>;
};

const GROUP_UNSPECIFIED = "Unspecified";

// Column helper for comparison rows
const comparisonColumnHelper = createColumnHelper<ComparisonRow>();

/**
 * Build columns for comparison mode
 */
const buildComparisonColumns = (
  comparisonData: ComparisonRunData[],
  hiddenColumns: Set<string>,
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
        <Text
          fontSize="12px"
          color="fg.muted"
          textAlign="right"
          paddingRight={1}
        >
          {row.original.index + 1}
        </Text>
      ),
    }),
  );

  // Dataset columns with diff values
  for (const [colName, _col] of allDatasetColumns) {
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
            }),
          );

          if (uniqueValues.size === 1 && values[0]) {
            return values[0].value;
          }

          return <DiffCell values={values} />;
        },
      }),
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
                  <Text fontSize="13px" color="fg.subtle">
                    -
                  </Text>
                ),
              };
            });

          return <DiffCell values={values} />;
        },
      }),
    );
  }

  return columns;
};

/**
 * Transform comparison data into row format
 */
const buildComparisonRows = (
  comparisonData: ComparisonRunData[],
): ComparisonRow[] => {
  // Find the max row count across all runs
  const maxRows = Math.max(
    0,
    ...comparisonData
      .filter((run) => run.data !== null)
      .map((run) => run.data!.rows.length),
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

/**
 * Pick the group value for a row from whichever run carries it.
 * Falls back to "Unspecified" if no run has a usable value.
 */
const getGroupValueForRow = (
  row: ComparisonRow,
  groupBy: string,
): string => {
  for (const runId of Object.keys(row.datasetEntries)) {
    const entry = row.datasetEntries[runId];
    const value = entry?.[groupBy];
    if (value === null || value === undefined || value === "") continue;
    if (typeof value === "object") continue;
    return String(value);
  }
  return GROUP_UNSPECIFIED;
};

/**
 * Bucket rows by group value, preserving first-seen order and pushing
 * the "Unspecified" bucket to the end so users notice the catch-all.
 */
const bucketRowsByGroup = (
  rows: ComparisonRow[],
  groupBy: string,
): Array<{ value: string; rows: ComparisonRow[] }> => {
  const buckets = new Map<string, ComparisonRow[]>();
  for (const row of rows) {
    const value = getGroupValueForRow(row, groupBy);
    const existing = buckets.get(value) ?? [];
    existing.push(row);
    buckets.set(value, existing);
  }
  const ordered = Array.from(buckets.entries()).map(([value, rows]) => ({
    value,
    rows,
  }));
  ordered.sort((a, b) => {
    if (a.value === GROUP_UNSPECIFIED) return 1;
    if (b.value === GROUP_UNSPECIFIED) return -1;
    return 0;
  });
  return ordered;
};

type GroupAggregates = Record<
  string, // runId
  Record<string, { mean: number; count: number; evaluatorName: string }>
>;

/**
 * Mean evaluator score per (runId, evaluatorId) across the rows in the
 * group. Aggregates from `evaluatorResults` rather than the top-level
 * evaluatorIds list — that field can be V2/V3 keyed and is not needed
 * here since we only display present scores.
 */
const computeGroupAggregates = (
  rowsInGroup: ComparisonRow[],
  comparisonData: ComparisonRunData[],
): GroupAggregates => {
  const result: GroupAggregates = {};
  for (const run of comparisonData) {
    const perEval = new Map<
      string,
      { sum: number; count: number; evaluatorName: string }
    >();
    for (const row of rowsInGroup) {
      const targets = row.targetsByRun[run.runId];
      if (!targets) continue;
      for (const target of Object.values(targets)) {
        for (const ev of target.evaluatorResults) {
          if (ev.score === null || ev.score === undefined) continue;
          const slot = perEval.get(ev.evaluatorId) ?? {
            sum: 0,
            count: 0,
            evaluatorName: ev.evaluatorName,
          };
          slot.sum += ev.score;
          slot.count += 1;
          perEval.set(ev.evaluatorId, slot);
        }
      }
    }
    result[run.runId] = {};
    for (const [evId, slot] of perEval) {
      result[run.runId]![evId] = {
        mean: slot.sum / slot.count,
        count: slot.count,
        evaluatorName: slot.evaluatorName,
      };
    }
  }
  return result;
};

export function ComparisonTable({
  comparisonData,
  isLoading,
  hiddenColumns = new Set(),
  disableVirtualization = false,
  groupBy: controlledGroupBy,
  onGroupByChange,
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

  // Group-by: controlled (parent owns URL sync) or internal (component-local).
  const [internalGroupBy, setInternalGroupBy] = useState<string | null>(null);
  const effectiveGroupBy =
    controlledGroupBy !== undefined ? controlledGroupBy : internalGroupBy;
  const handleGroupByChange = useCallback(
    (next: string | null) => {
      if (onGroupByChange) onGroupByChange(next);
      else setInternalGroupBy(next);
    },
    [onGroupByChange],
  );

  const { availableKeys } = useResultsGrouping({
    source: "dataset-entry",
    comparisonData,
  });

  // Group-by dropdown state. Match the chart's portal-popover pattern
  // (see ComparisonCharts.tsx) so the menu can't be clipped by an
  // overflow:hidden ancestor in BatchEvaluationResults.
  const [groupByDropdownOpen, setGroupByDropdownOpen] = useState(false);
  const [groupByBtnRect, setGroupByBtnRect] = useState<DOMRect | null>(null);
  const groupByBtnRef = useRef<HTMLButtonElement>(null);
  const openGroupByDropdown = () => {
    const rect = groupByBtnRef.current?.getBoundingClientRect() ?? null;
    setGroupByBtnRect(rect);
    setGroupByDropdownOpen(true);
  };

  // Collapse state for grouped sections.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleCollapse = useCallback((value: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

  // Bucket rows when grouping is active.
  const groupedRows = useMemo(() => {
    if (!effectiveGroupBy) return null;
    return bucketRowsByGroup(comparisonRows, effectiveGroupBy);
  }, [comparisonRows, effectiveGroupBy]);

  // State for scroll container - using state triggers re-render when mounted
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(
    null,
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
    [scrollContainer],
  );
  const estimateSize = useCallback(() => ROW_HEIGHT, []);

  // Set up row virtualization with dynamic measurement. Virtualization
  // assumes a flat tbody — when grouping is active we render multiple
  // <tbody> sections, so we skip the virtualizer in that mode.
  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement,
    estimateSize,
    overscan: 5,
    enabled: !!scrollContainer && !groupedRows,
    measureElement:
      typeof window !== "undefined"
        ? (element) => element?.getBoundingClientRect().height ?? ROW_HEIGHT
        : undefined,
  });

  // Loading state
  if (isLoading) {
    return <TableSkeleton />;
  }

  // Empty state
  if (comparisonRows.length === 0) {
    return (
      <Box padding={6} textAlign="center">
        <Text color="fg.muted">No results to display</Text>
      </Box>
    );
  }

  // Calculate minimum table width from first run with data
  const firstRunWithData = comparisonData.find((run) => run.data !== null);
  const datasetColCount =
    firstRunWithData?.data?.datasetColumns.filter(
      (c) => !hiddenColumns.has(c.name),
    ).length ?? 0;
  const targetColCount = firstRunWithData?.data?.targetColumns.length ?? 0;
  const minTableWidth = calculateMinTableWidth(datasetColCount, targetColCount);

  const tableStyles = getTableStyles(minTableWidth);
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const tableRows = table.getRowModel().rows;
  const columnCount = table.getAllColumns().length;
  // Lookup table-row by original index, so the grouped render can reuse
  // TanStack's column model without rebuilding cells from scratch.
  const tableRowByIndex = new Map(
    tableRows.map((r) => [r.original.index, r] as const),
  );

  // Calculate padding to maintain scroll position (only when virtualizing)
  const paddingTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0;

  const showGroupByControl = availableKeys.length > 0;
  const dropdownOptions: Array<{ key: string | null; label: string }> = [
    { key: null, label: "No grouping" },
    ...availableKeys.map((k) => ({ key: k, label: k })),
  ];

  return (
    <VStack align="stretch" width="100%" height="100%" gap={0}>
      {showGroupByControl && (
        <HStack paddingX={2} paddingY={2} flexShrink={0}>
          <Box>
            <Button
              ref={groupByBtnRef}
              size="xs"
              variant="outline"
              onClick={() =>
                groupByDropdownOpen
                  ? setGroupByDropdownOpen(false)
                  : openGroupByDropdown()
              }
              data-testid="group-by-row-button"
            >
              Group rows by: {effectiveGroupBy ?? "No grouping"}
            </Button>
            {groupByDropdownOpen && groupByBtnRect && (
              <Portal>
                <Box
                  position="fixed"
                  inset={0}
                  zIndex={1000}
                  onClick={() => setGroupByDropdownOpen(false)}
                  data-testid="group-by-row-backdrop"
                />
                <Box
                  position="fixed"
                  top={`${groupByBtnRect.bottom + 4}px`}
                  left={`${groupByBtnRect.left}px`}
                  bg="bg.panel"
                  border="1px solid"
                  borderColor="border"
                  borderRadius="md"
                  boxShadow="md"
                  zIndex={1001}
                  minWidth="180px"
                  padding={2}
                  style={{
                    maxHeight: `calc(100vh - ${groupByBtnRect.bottom + 16}px)`,
                    overflowY: "auto",
                  }}
                  data-testid="group-by-row-dropdown"
                >
                  <VStack align="stretch" gap={1}>
                    {dropdownOptions.map((opt) => {
                      const selected = effectiveGroupBy === opt.key ||
                        (effectiveGroupBy == null && opt.key === null);
                      return (
                        <HStack
                          key={opt.key ?? "none"}
                          padding={1}
                          borderRadius="sm"
                          cursor="pointer"
                          bg={selected ? "blue.subtle" : "transparent"}
                          _hover={{
                            bg: selected ? "blue.muted" : "bg.subtle",
                          }}
                          onClick={() => {
                            handleGroupByChange(opt.key);
                            setGroupByDropdownOpen(false);
                          }}
                          data-testid={`group-by-row-option-${opt.key ?? "none"}`}
                        >
                          <Text
                            fontSize="sm"
                            fontWeight={selected ? "medium" : "normal"}
                            color={selected ? "blue.fg" : "inherit"}
                          >
                            {opt.label}
                          </Text>
                        </HStack>
                      );
                    })}
                  </VStack>
                </Box>
              </Portal>
            )}
          </Box>
        </HStack>
      )}

      <Box
        ref={scrollContainerRef}
        overflowX="auto"
        overflowY="auto"
        width="100%"
        flex={1}
        minHeight={0}
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
                          header.getContext(),
                        )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          {groupedRows ? (
            // Grouped mode: one <tbody> per group. Header row spans all
            // columns and carries the per-run mean badges.
            groupedRows.map(({ value, rows }) => {
              const aggregates = computeGroupAggregates(rows, comparisonData);
              const collapsed = collapsedGroups.has(value);
              return (
                <tbody
                  key={value}
                  data-testid={`group-section-${value}`}
                >
                  <tr data-testid={`group-header-${value}`}>
                    <td
                      colSpan={columnCount}
                      style={{
                        background: "var(--chakra-colors-bg-subtle)",
                        borderTop: "1px solid var(--chakra-colors-border)",
                        borderBottom:
                          "1px solid var(--chakra-colors-border)",
                        padding: "6px 8px",
                      }}
                    >
                      <HStack gap={3} align="center">
                        <Box
                          as="button"
                          aria-label={collapsed ? "Expand" : "Collapse"}
                          onClick={() => toggleCollapse(value)}
                          data-testid={`group-header-toggle-${value}`}
                          fontSize="12px"
                          color="fg.muted"
                          paddingX={1}
                          cursor="pointer"
                        >
                          {collapsed ? "▶" : "▼"}
                        </Box>
                        <Text fontSize="13px" fontWeight="semibold">
                          {value}
                        </Text>
                        <Text
                          fontSize="12px"
                          color="fg.muted"
                          data-testid={`group-count-${value}`}
                        >
                          {rows.length}
                          {rows.length === 1 ? " row" : " rows"}
                        </Text>
                        <Spacer />
                        <HStack gap={4} align="start">
                          {comparisonData.map((run) => {
                            const perEval = aggregates[run.runId] ?? {};
                            const entries = Object.entries(perEval);
                            if (entries.length === 0) return null;
                            return (
                              <VStack key={run.runId} gap={0} align="end">
                                {entries.map(([evId, stats]) => (
                                  <HStack
                                    key={evId}
                                    gap={1}
                                    fontSize="11px"
                                    color="fg.muted"
                                  >
                                    <Box
                                      width="6px"
                                      height="6px"
                                      borderRadius="full"
                                      bg={run.color}
                                    />
                                    <Text>{stats.evaluatorName}</Text>
                                    <Text
                                      fontWeight="medium"
                                      color="fg"
                                      data-testid={`group-mean-${value}-${run.runId}-${evId}`}
                                    >
                                      {stats.mean.toFixed(2)}
                                    </Text>
                                  </HStack>
                                ))}
                              </VStack>
                            );
                          })}
                        </HStack>
                      </HStack>
                    </td>
                  </tr>
                  {!collapsed &&
                    rows.map((comparisonRow) => {
                      const tableRow = tableRowByIndex.get(
                        comparisonRow.index,
                      );
                      if (!tableRow) return null;
                      return (
                        <tr
                          key={tableRow.id}
                          data-index={tableRow.index}
                        >
                          {tableRow.getVisibleCells().map((cell) => (
                            <td
                              key={cell.id}
                              style={{ width: cell.column.getSize() }}
                            >
                              {flexRender(
                                cell.column.columnDef.cell,
                                cell.getContext(),
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                </tbody>
              );
            })
          ) : (
            <tbody>
              {disableVirtualization ? (
                // Test mode: render all rows without virtualization
                tableRows.map((row) => (
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
                    const row = tableRows[virtualRow.index];
                    if (!row) return null;
                    return (
                      <tr
                        key={row.id}
                        data-index={virtualRow.index}
                        ref={rowVirtualizer.measureElement}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <td
                            key={cell.id}
                            style={{ width: cell.column.getSize() }}
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
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
          )}
        </table>
      </Box>
    </VStack>
  );
}
