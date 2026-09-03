/**
 * ComparisonTable - Table component for comparing multiple evaluation runs.
 *
 * Displays stacked per-run values with colored indicators. Optionally
 * groups rows under collapsible headers keyed on a dataset-entry
 * metadata field (issue #4632).
 */

import { Box, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  type Row,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronRight } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { ColumnTypeIcon } from "@langwatch/design-system/column-type-icon";
import { BatchTargetCell } from "./batch-target-cell";
import { DiffCell, type DiffValue } from "../../elements/batch-results/diff-cell";
import { ExpandableDatasetCell } from "./expandable-dataset-cell";
import { TableSkeleton } from "../../elements/batch-results/table-skeleton";
import {
  calculateMinTableWidth,
  DEFAULT_ROW_HEIGHT,
  ESTIMATED_ROW_HEIGHT_PX,
  getTableStyles,
  type RowHeight,
} from "./table-utils";
import {
  type DescribeBatchCellFailure,
  type RenderBatchEvaluatorResult,
  type RenderTracePeek,
} from "./presentation";
import type {
  BatchDatasetColumn,
  BatchResultRow,
  BatchTargetColumn,
  ComparisonRunData,
} from "../batch-evaluation-results.types";
import { useResultsGrouping } from "../use-results-grouping";

type ComparisonTableProps = {
  /** Comparison data from multiple runs */
  comparisonData: ComparisonRunData[];
  /** Loading state */
  isLoading?: boolean;
  /** Hidden column names */
  hiddenColumns?: Set<string>;
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
  /**
   * Group rows by this dataset-entry metadata key. `null`/undefined =
   * flat (no grouping). Always controlled: the picker lives in the results
   * toolbar (`GroupRowsButton`), which owns the selection and its URL sync.
   */
  groupBy?: string | null;
  describeFailure?: DescribeBatchCellFailure;
  renderEvaluatorResult?: RenderBatchEvaluatorResult;
  renderTracePeek?: RenderTracePeek;
  onOpenTrace?: (traceId: string) => void;
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

const GROUP_UNSPECIFIED = "Unspecified";

// Column helper for comparison rows
const comparisonColumnHelper = createColumnHelper<ComparisonRow>();

type BuildComparisonColumnsOptions = {
  comparisonData: ComparisonRunData[];
  hiddenColumns: Set<string>;
  showOutputs: boolean;
  showEvaluations: boolean;
  showCostAndLatency: boolean;
  rowHeight: RowHeight;
  describeFailure?: DescribeBatchCellFailure;
  renderEvaluatorResult?: RenderBatchEvaluatorResult;
  renderTracePeek?: RenderTracePeek;
  onOpenTrace?: (traceId: string) => void;
};

/**
 * Build columns for comparison mode
 */
const buildComparisonColumns = ({
  comparisonData,
  hiddenColumns,
  showOutputs,
  showEvaluations,
  showCostAndLatency,
  rowHeight,
  describeFailure,
  renderEvaluatorResult,
  renderTracePeek,
  onOpenTrace,
}: BuildComparisonColumnsOptions) => {
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
        <Text fontSize="12px" color="fg.muted" textAlign="right" paddingRight={1}>
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
                  <ExpandableDatasetCell value={value} columnName={colName} rowHeight={rowHeight} />
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

  // Target columns with diff values.
  // Skip them entirely when no target field is shown.
  const showTargetColumns = showOutputs || showEvaluations || showCostAndLatency;
  for (const [targetId, targetCol] of showTargetColumns
    ? allTargetColumns
    : new Map<string, BatchTargetColumn>()) {
    columns.push(
      comparisonColumnHelper.accessor((row) => row.targetsByRun, {
        id: `target_${targetId}`,
        header: () => (
          <Text fontSize="13px" fontWeight="medium">
            {targetCol.displayName ?? targetCol.name}
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
                  <BatchTargetCell
                    targetOutput={targetOutput}
                    showOutput={showOutputs}
                    showEvaluations={showEvaluations}
                    showCostAndLatency={showCostAndLatency}
                    rowHeight={rowHeight}
                    describeFailure={describeFailure}
                    renderEvaluatorResult={renderEvaluatorResult}
                    renderTracePeek={renderTracePeek}
                    onOpenTrace={onOpenTrace}
                  />
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
const buildComparisonRows = (comparisonData: ComparisonRunData[]): ComparisonRow[] => {
  // Find the max row count across all runs
  const maxRows = Math.max(
    0,
    ...comparisonData.filter((run) => run.data !== null).map((run) => run.data!.rows.length),
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

/**
 * Pick the group value for a row from whichever run carries it.
 * Falls back to "Unspecified" if no run has a usable value.
 */
const getGroupValueForRow = (row: ComparisonRow, groupBy: string): string => {
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
  // Insertion order is whatever the rows happened to arrive in, so the same
  // data could group differently between two loads. Sort by value, numerically
  // when both sides are numbers so "10" does not land between "1" and "2".
  // Unspecified always sinks: it is the absence of a value, not one of them.
  ordered.sort((a, b) => {
    if (a.value === GROUP_UNSPECIFIED) return 1;
    if (b.value === GROUP_UNSPECIFIED) return -1;
    const na = Number(a.value);
    const nb = Number(b.value);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.value.localeCompare(b.value);
  });
  return ordered;
};

type GroupAggregates = Record<
  string, // runId
  Record<string, { mean: number; count: number; evaluatorName: string }>
>;

/** Running sum/count per evaluatorId, before it is turned into a mean. */
type EvaluatorScoreTotals = Map<string, { sum: number; count: number; evaluatorName: string }>;

/** Fold one target's scored evaluator results into the running totals. */
const accumulateTargetScores = (
  totals: EvaluatorScoreTotals,
  target: BatchResultRow["targets"][string],
): void => {
  for (const ev of target.evaluatorResults) {
    if (ev.score === null || ev.score === undefined) continue;
    const slot = totals.get(ev.evaluatorId) ?? {
      sum: 0,
      count: 0,
      evaluatorName: ev.evaluatorName,
    };
    slot.sum += ev.score;
    slot.count += 1;
    totals.set(ev.evaluatorId, slot);
  }
};

const meanScores = (totals: EvaluatorScoreTotals): GroupAggregates[string] => {
  const means: GroupAggregates[string] = {};
  for (const [evaluatorId, slot] of totals) {
    means[evaluatorId] = {
      mean: slot.sum / slot.count,
      count: slot.count,
      evaluatorName: slot.evaluatorName,
    };
  }
  return means;
};

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
    const totals: EvaluatorScoreTotals = new Map();
    for (const row of rowsInGroup) {
      for (const target of Object.values(row.targetsByRun[run.runId] ?? {})) {
        accumulateTargetScores(totals, target);
      }
    }
    result[run.runId] = meanScores(totals);
  }
  return result;
};

/** Per-run mean evaluator scores, shown on the right of a group header. */
const GroupMeanBadges = ({
  value,
  aggregates,
  comparisonData,
}: {
  value: string;
  aggregates: GroupAggregates;
  comparisonData: ComparisonRunData[];
}) => (
  <HStack gap={4} align="start">
    {comparisonData.map((run) => {
      const entries = Object.entries(aggregates[run.runId] ?? {});
      if (entries.length === 0) return null;
      return (
        <VStack key={run.runId} gap={0} align="end">
          {entries.map(([evId, stats]) => (
            <HStack key={evId} gap={1} fontSize="11px" color="fg.muted">
              <Box width="6px" height="6px" borderRadius="full" bg={run.color} />
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
);

/** The full-width header row that opens each group's <tbody>. */
const GroupHeaderRow = ({
  value,
  rowCount,
  aggregates,
  comparisonData,
  columnCount,
  collapsed,
  onToggleCollapse,
}: {
  value: string;
  rowCount: number;
  aggregates: GroupAggregates;
  comparisonData: ComparisonRunData[];
  columnCount: number;
  collapsed: boolean;
  onToggleCollapse: (value: string) => void;
}) => (
  <tr data-testid={`group-header-${value}`}>
    <td
      colSpan={columnCount}
      style={{
        background: "var(--chakra-colors-bg-subtle)",
        borderTop: "1px solid var(--chakra-colors-border)",
        borderBottom: "1px solid var(--chakra-colors-border)",
        padding: "6px 8px",
      }}
    >
      <HStack gap={3} align="center">
        <Box
          as="button"
          aria-label={collapsed ? "Expand" : "Collapse"}
          onClick={() => onToggleCollapse(value)}
          data-testid={`group-header-toggle-${value}`}
          fontSize="12px"
          color="fg.muted"
          paddingX={1}
          cursor="pointer"
          display="flex"
          alignItems="center"
        >
          {/* One rotating chevron rather than swapping two glyphs — the
              arrow turns instead of the row flickering between characters. */}
          <ChevronRight
            size={13}
            style={{
              transform: collapsed ? "rotate(0deg)" : "rotate(90deg)",
              transition: "transform 140ms ease",
            }}
          />
        </Box>
        <Text fontSize="13px" fontWeight="semibold">
          {value}
        </Text>
        <Text fontSize="12px" color="fg.muted" data-testid={`group-count-${value}`}>
          {rowCount}
          {rowCount === 1 ? " row" : " rows"}
        </Text>
        <Spacer />
        <GroupMeanBadges value={value} aggregates={aggregates} comparisonData={comparisonData} />
      </HStack>
    </td>
  </tr>
);

/** One <tbody> per group: header row plus the group's data rows. */
const GroupSection = ({
  value,
  rows,
  aggregates,
  comparisonData,
  columnCount,
  collapsed,
  onToggleCollapse,
  tableRowByIndex,
}: {
  value: string;
  rows: ComparisonRow[];
  aggregates: GroupAggregates;
  comparisonData: ComparisonRunData[];
  columnCount: number;
  collapsed: boolean;
  onToggleCollapse: (value: string) => void;
  tableRowByIndex: Map<number, Row<ComparisonRow>>;
}) => (
  <tbody data-testid={`group-section-${value}`}>
    <GroupHeaderRow
      value={value}
      rowCount={rows.length}
      aggregates={aggregates}
      comparisonData={comparisonData}
      columnCount={columnCount}
      collapsed={collapsed}
      onToggleCollapse={onToggleCollapse}
    />
    {!collapsed &&
      rows.map((comparisonRow) => {
        const tableRow = tableRowByIndex.get(comparisonRow.index);
        if (!tableRow) return null;
        return (
          <tr key={tableRow.id} data-index={tableRow.index}>
            {tableRow.getVisibleCells().map((cell) => (
              <td key={cell.id} style={{ width: cell.column.getSize() }}>
                {flexRender(cell.column.columnDef.cell, cell.getContext())}
              </td>
            ))}
          </tr>
        );
      })}
  </tbody>
);

export function ComparisonTable({
  comparisonData,
  isLoading,
  hiddenColumns = new Set(),
  showOutputs = true,
  showEvaluations = true,
  showCostAndLatency = true,
  rowHeight = DEFAULT_ROW_HEIGHT,
  disableVirtualization = false,
  groupBy: requestedGroupBy = null,
  describeFailure,
  renderEvaluatorResult,
  renderTracePeek,
  onOpenTrace,
}: ComparisonTableProps) {
  // Build columns for comparison mode
  const columns = useMemo(() => {
    return buildComparisonColumns({
      comparisonData,
      hiddenColumns,
      showOutputs,
      showEvaluations,
      showCostAndLatency,
      rowHeight,
      describeFailure,
      renderEvaluatorResult,
      renderTracePeek,
      onOpenTrace,
    });
  }, [
    comparisonData,
    hiddenColumns,
    showOutputs,
    showEvaluations,
    showCostAndLatency,
    rowHeight,
    describeFailure,
    renderEvaluatorResult,
    renderTracePeek,
    onOpenTrace,
  ]);

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

  const { availableKeys } = useResultsGrouping({
    source: "dataset-entry",
    comparisonData,
  });

  // A group-by key only means something if this comparison actually has it.
  // The value comes from the URL, so `?groupBy=input` survives a link being
  // shared into a run that has no such field — grouping on it would put every
  // row in its own singleton group and read as a broken table rather than as a
  // stale parameter.
  const effectiveGroupBy =
    requestedGroupBy && availableKeys.includes(requestedGroupBy) ? requestedGroupBy : null;

  // Collapse state for grouped sections.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const toggleCollapse = useCallback((value: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }, []);

  // Bucket rows when grouping is active.
  // Aggregates are computed here rather than in the render body: grouped mode
  // turns the virtualizer off, so every group is mounted at once and a call
  // per group would re-run an O(groups x rows x targets x evaluators) pass on
  // each render — including renders that only opened a dropdown.
  const groupedRows = useMemo(() => {
    if (!effectiveGroupBy) return null;
    return bucketRowsByGroup(comparisonRows, effectiveGroupBy).map((group) => ({
      ...group,
      aggregates: computeGroupAggregates(group.rows, comparisonData),
    }));
  }, [comparisonRows, effectiveGroupBy, comparisonData]);

  // State for scroll container - using state triggers re-render when mounted
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);

  // Callback ref to set the scroll container
  const scrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    setScrollContainer(node);
  }, []);

  // Get row count from source data to avoid React scheduling loops
  const rowCount = comparisonRows.length;

  // Stable callbacks for virtualizer
  const getScrollElement = useCallback(() => scrollContainer, [scrollContainer]);
  const estimatedRowHeight = ESTIMATED_ROW_HEIGHT_PX[rowHeight];
  const estimateSize = useCallback(() => estimatedRowHeight, [estimatedRowHeight]);

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
        ? (element) => element?.getBoundingClientRect().height ?? estimatedRowHeight
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
    firstRunWithData?.data?.datasetColumns.filter((c) => !hiddenColumns.has(c.name)).length ?? 0;
  const targetColCount =
    showOutputs || showEvaluations || showCostAndLatency
      ? (firstRunWithData?.data?.targetColumns.length ?? 0)
      : 0;
  const minTableWidth = calculateMinTableWidth(datasetColCount, targetColCount);

  const tableStyles = getTableStyles(minTableWidth);
  const virtualRows = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const tableRows = table.getRowModel().rows;
  const columnCount = table.getAllColumns().length;
  // Lookup table-row by original index, so the grouped render can reuse
  // TanStack's column model without rebuilding cells from scratch.
  const tableRowByIndex = new Map(tableRows.map((r) => [r.original.index, r] as const));

  // Calculate padding to maintain scroll position (only when virtualizing)
  const paddingTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualRows.length > 0 ? totalSize - (virtualRows[virtualRows.length - 1]?.end ?? 0) : 0;

  return (
    <VStack align="stretch" width="100%" height="100%" gap={0}>
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
                      : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>

          {groupedRows ? (
            // Grouped mode: one <tbody> per group. Header row spans all
            // columns and carries the per-run mean badges.
            groupedRows.map(({ value, rows, aggregates }) => (
              <GroupSection
                key={value}
                value={value}
                rows={rows}
                aggregates={aggregates}
                comparisonData={comparisonData}
                columnCount={columnCount}
                collapsed={collapsedGroups.has(value)}
                onToggleCollapse={toggleCollapse}
                tableRowByIndex={tableRowByIndex}
              />
            ))
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
                      <td style={{ height: `${paddingTop}px`, padding: 0 }} colSpan={columnCount} />
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
          )}
        </table>
      </Box>
    </VStack>
  );
}
