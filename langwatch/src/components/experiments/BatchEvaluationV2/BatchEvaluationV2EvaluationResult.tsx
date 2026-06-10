/**
 * Read-only results table for a batch evaluation run: dataset inputs,
 * predicted outputs, evaluator inputs, cost/duration, and the evaluator's
 * score/passed/label/details per row.
 *
 * Virtualized TanStack-style table (fixed row heights) with the live-run
 * affordances the old grid had: stays pinned to the bottom while results
 * stream in (unless the user scrolls up), click-to-expand on any value
 * cell, and error/skipped/true/false cell tinting.
 */
import { Box, Button, HStack } from "@chakra-ui/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import numeral from "numeral";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { TraceIdPeek } from "~/features/traces-v2/components/TraceIdPeek";
import { useDrawer } from "~/hooks/useDrawer";
import type { ExperimentRunWithItems } from "../../../server/experiments-v3/services/types";
import { formatMilliseconds } from "../../../utils/formatMilliseconds";
import { formatMoney } from "../../../utils/formatMoney";
import { ExternalImage, getImageUrl } from "../../ExternalImage";
import { ExpandedTextDialog, HoverableBigText } from "../../HoverableBigText";
import { getEvaluationColumns } from "./utils";

type EvaluationRowData = {
  rowNumber: number;
  datasetEntry?: ExperimentRunWithItems["dataset"][number];
  evaluationsForEntry: Record<
    string,
    ExperimentRunWithItems["evaluations"][number] | undefined
  >;
};

type CellState = "error" | "skipped" | "true" | "false" | undefined;

type ResultColumn = {
  id: string;
  header: string;
  minWidth: number;
  /** Returns the rendered cell content. */
  render: (row: EvaluationRowData) => ReactNode;
  /** Plain-text value used for the expand-on-click dialog and the title
   *  tooltip. Return undefined to disable both for the cell. */
  text?: (row: EvaluationRowData) => string | undefined;
  cellState?: (row: EvaluationRowData) => CellState;
  expandable?: boolean;
};

const CELL_STATE_BG: Record<NonNullable<CellState>, string> = {
  error: "rgba(255, 0, 0, 0.2)",
  skipped: "rgba(255, 255, 0, 0.2)",
  true: "rgba(0, 128, 0, 0.15)",
  false: "rgba(255, 0, 0, 0.15)",
};

export function BatchEvaluationV2EvaluationResult({
  evaluator,
  results,
  datasetByIndex,
  datasetColumns,
  predictedColumns,
  isFinished: _isFinished,
  size = "md",
  workflowId: _workflowId,
}: {
  evaluator: string;
  results: ExperimentRunWithItems["evaluations"];
  datasetByIndex: Record<number, ExperimentRunWithItems["dataset"][number]>;
  datasetColumns: Set<string>;
  predictedColumns: Record<string, Set<string>>;
  isFinished: boolean;
  size?: "sm" | "md";
  workflowId: string | null;
}) {
  const evaluatorHeaders = getEvaluationColumns(results);
  const containerRef = useRef<HTMLDivElement>(null);
  const isPinnedToBottomRef = useRef(true);
  const { openDrawer } = useDrawer();
  const [expandedText, setExpandedText] = useState<string | undefined>(void 0);

  const rowHeight = size === "sm" ? 28 : 34;

  const totalRows = Math.max(
    ...Object.values(datasetByIndex).map((d) => d.index + 1),
    0,
  );

  const rowData = useMemo(
    () =>
      Array.from({ length: totalRows }).map((_, index) => ({
        rowNumber: index + 1,
        datasetEntry: datasetByIndex[index],
        evaluationsForEntry: {
          [evaluator]: results.find((r) => r.index === index),
        },
      })),
    [totalRows, datasetByIndex, evaluator, results],
  );

  const columns = useMemo((): ResultColumn[] => {
    const cols: ResultColumn[] = [];

    cols.push({
      id: "rowNumber",
      header: "",
      minWidth: 60,
      render: (row) => row.rowNumber,
      text: () => undefined,
    });

    // Dataset columns
    const firstEntry = Object.values(datasetByIndex)[0];
    for (const column of Array.from(datasetColumns)) {
      const mightHaveImages =
        typeof firstEntry?.entry?.[column] === "string" &&
        getImageUrl(firstEntry.entry[column]!);
      cols.push({
        id: `dataset_${column}`,
        header: `Dataset Input (${column})`,
        minWidth: 150,
        render: (row) => {
          const val = row.datasetEntry?.entry?.[column];
          if (mightHaveImages) {
            const img = getImageUrl((val as string) ?? "");
            if (img) {
              return (
                <ExternalImage
                  src={img}
                  minWidth="24px"
                  minHeight="24px"
                  maxHeight={`${rowHeight - 6}px`}
                  maxWidth="100%"
                />
              );
            }
          }
          return formatValue(val);
        },
        text: (row) => stringify(row.datasetEntry?.entry?.[column] ?? "-"),
      });
    }

    // Predicted columns
    Object.entries(predictedColumns ?? {}).forEach(([node, nodeColumns]) => {
      for (const column of Array.from(nodeColumns)) {
        const predictedValue = (row: EvaluationRowData) => {
          const entry = row.datasetEntry;
          if (entry?.error) return entry.error;
          let value = (entry?.predicted as any)?.[node]?.[column];
          if (value === void 0 && node === "end")
            value = (entry?.predicted as any)?.[column];
          return value;
        };
        cols.push({
          id: `predicted_${node}_${column}`,
          header: titleCase(column),
          minWidth: 150,
          render: (row) => formatValue(predictedValue(row)),
          text: (row) => stringify(predictedValue(row) ?? "-"),
          cellState: (row) =>
            row.datasetEntry?.error ? "error" : undefined,
        });
      }
    });

    // Evaluation input columns
    if (
      results.length > 0 &&
      evaluatorHeaders.evaluationInputsColumns.size > 0
    ) {
      for (const column of Array.from(
        evaluatorHeaders.evaluationInputsColumns,
      )) {
        cols.push({
          id: `eval_input_${column}`,
          header: titleCase(column),
          minWidth: 150,
          render: (row) => {
            const { datasetEntry, evaluationsForEntry } = row;
            if (datasetEntry?.error) return "Error";
            const value = evaluationsForEntry[evaluator]?.inputs?.[column];
            return evaluationsForEntry[evaluator]
              ? stringify(value ?? "-")
              : "-";
          },
          text: (row) => {
            if (row.datasetEntry?.error) return row.datasetEntry.error;
            return stringify(
              row.evaluationsForEntry[evaluator]?.inputs?.[column] ?? "-",
            );
          },
          cellState: (row) =>
            row.datasetEntry?.error ? "error" : undefined,
        });
      }
    }

    // Cost
    cols.push({
      id: "cost",
      header: "Cost",
      minWidth: 120,
      render: (row) => {
        const total =
          (row.datasetEntry?.cost ?? 0) +
          (row.evaluationsForEntry[evaluator]?.cost ?? 0);
        return total
          ? formatMoney({ amount: total, currency: "USD" }, "$0.00[00]")
          : "-";
      },
      text: (row) => {
        const predCost = row.datasetEntry?.cost ?? 0;
        const evalCost = row.evaluationsForEntry[evaluator]?.cost ?? 0;
        if (!predCost && !evalCost) return "-";
        const fmt = (v: number) =>
          formatMoney({ amount: v, currency: "USD" }, "$0.00[00]");
        return `Prediction: ${predCost ? fmt(predCost) : "-"}, Evaluation: ${
          evalCost ? fmt(evalCost) : "-"
        }`;
      },
    });

    // Duration
    cols.push({
      id: "duration",
      header: "Duration",
      minWidth: 120,
      render: (row) => {
        const total =
          (row.datasetEntry?.duration ?? 0) +
          (row.evaluationsForEntry[evaluator]?.duration ?? 0);
        return total ? formatMilliseconds(total) : "-";
      },
      text: (row) => {
        const predDur = row.datasetEntry?.duration ?? 0;
        const evalDur = row.evaluationsForEntry[evaluator]?.duration ?? 0;
        if (!predDur && !evalDur) return "-";
        return `Prediction: ${
          predDur ? formatMilliseconds(predDur) : "-"
        }, Evaluation: ${evalDur ? formatMilliseconds(evalDur) : "-"}`;
      },
    });

    // Evaluation result columns (stable order)
    const evalResultPreferredOrder = [
      "score",
      "passed",
      "label",
      "details",
    ] as const;
    const evaluationResultsColumnsOrdered = evalResultPreferredOrder.filter(
      (c) => evaluatorHeaders.evaluationResultsColumns.has(c),
    );

    for (const column of evaluationResultsColumnsOrdered) {
      const isDetails = column === "details";
      const formatEvalValue = (value: any) => {
        if (value === false) return "false";
        if (value === true) return "true";
        return !Number.isNaN(Number(value))
          ? numeral(Number(value)).format("0.[00]")
          : (value ?? "-");
      };

      cols.push({
        id: `eval_result_${column}`,
        header: titleCase(column),
        minWidth: isDetails ? 240 : 120,
        render: (row) => {
          const evaluation = row.evaluationsForEntry[evaluator] as
            | Record<string, any>
            | undefined;
          if (isDetails) {
            return (
              <HoverableBigText
                lineClamp={1}
                maxWidth="300px"
                whiteSpace="pre-wrap"
              >
                {evaluation?.[column]}
              </HoverableBigText>
            );
          }
          if (evaluation?.status === "error") return "Error";
          if (evaluation?.status === "skipped") return "Skipped";
          return formatEvalValue(evaluation?.[column]);
        },
        text: (row) => {
          const evaluation = row.evaluationsForEntry[evaluator] as
            | Record<string, any>
            | undefined;
          if (!isDetails && evaluation?.status === "error")
            return evaluation?.details ?? "Error";
          if (!isDetails && evaluation?.status === "skipped")
            return evaluation?.details ?? "Skipped";
          return `${formatEvalValue(evaluation?.[column])}`;
        },
        cellState: (row) => {
          const evaluation = row.evaluationsForEntry[evaluator] as
            | Record<string, any>
            | undefined;
          if (isDetails) return undefined;
          if (evaluation?.status === "error") return "error";
          if (evaluation?.status === "skipped") return "skipped";
          if (evaluation?.[column] === true) return "true";
          if (evaluation?.[column] === false) return "false";
          return undefined;
        },
      });
    }

    // Trace column
    const hasAnyTraceId = Object.values(datasetByIndex).some(
      (d) => d.traceId && d.traceId !== "0",
    );
    if (hasAnyTraceId) {
      cols.push({
        id: "trace",
        header: "Trace",
        minWidth: 90,
        render: (row) => {
          const traceId = row.datasetEntry?.traceId;
          return traceId ? (
            <HStack gap={1}>
              <Button
                size="xs"
                colorPalette="gray"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  openDrawer("traceDetails", {
                    traceId,
                    selectedTab: "traceDetails",
                  });
                }}
              >
                View
              </Button>
              <TraceIdPeek traceId={traceId} />
            </HStack>
          ) : (
            "-"
          );
        },
        text: () => undefined,
      });
    }

    return cols;
  }, [
    datasetColumns,
    predictedColumns,
    results.length,
    evaluatorHeaders,
    evaluator,
    openDrawer,
    datasetByIndex,
    rowHeight,
  ]);

  // Track whether the user is pinned to the bottom (live-run autoscroll)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => {
      isPinnedToBottomRef.current =
        container.scrollTop + container.clientHeight >=
        container.scrollHeight - 24;
    };
    onScroll();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, []);

  // Auto-scroll to bottom as results stream in, unless the user scrolled up
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isPinnedToBottomRef.current) return;
    const t = setTimeout(() => {
      container.scrollTop = container.scrollHeight;
    }, 100);
    return () => clearTimeout(t);
  }, [totalRows, results.length]);

  const rowVirtualizer = useVirtualizer({
    count: rowData.length,
    getScrollElement: () => containerRef.current,
    estimateSize: useCallback(() => rowHeight, [rowHeight]),
    overscan: 20,
  });

  const handleCellClick = useCallback(
    (column: ResultColumn, row: EvaluationRowData) => {
      const value = column.text?.(row);
      if (!value || value === "-") return;
      setExpandedText(value);
    },
    [],
  );

  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() -
        (virtualRows[virtualRows.length - 1]?.end ?? 0)
      : 0;

  return (
    <Box>
      <Box
        ref={containerRef}
        width="100%"
        height="60vh"
        overflow="auto"
        data-testid="batch-evaluation-results-table"
        css={{
          "& table": {
            width: "100%",
            borderCollapse: "collapse",
            fontSize: size === "sm" ? "12px" : "13px",
          },
          "& th": {
            position: "sticky",
            top: 0,
            zIndex: 2,
            background: "var(--chakra-colors-bg-subtle)",
            borderBottom: "1px solid var(--chakra-colors-border-muted)",
            borderRight: "1px solid var(--chakra-colors-border-muted)",
            padding: "4px 8px",
            textAlign: "left",
            fontWeight: 600,
            whiteSpace: "nowrap",
          },
          "& td": {
            borderBottom: "1px solid var(--chakra-colors-border-muted)",
            borderRight: "1px solid var(--chakra-colors-border-muted)",
            padding: "4px 8px",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            maxWidth: "300px",
            cursor: "pointer",
            height: `${rowHeight}px`,
          },
        }}
      >
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.id} style={{ minWidth: column.minWidth }}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paddingTop > 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{ height: paddingTop, padding: 0, border: "none" }}
                />
              </tr>
            )}
            {virtualRows.map((virtualRow) => {
              const row = rowData[virtualRow.index];
              if (!row) return null;
              return (
                <tr key={virtualRow.index} data-index={virtualRow.index}>
                  {columns.map((column) => {
                    const state = column.cellState?.(row);
                    const tooltip = column.text?.(row);
                    return (
                      <td
                        key={column.id}
                        title={
                          tooltip && tooltip.length < 1000
                            ? tooltip
                            : undefined
                        }
                        style={{
                          minWidth: column.minWidth,
                          background: state
                            ? CELL_STATE_BG[state]
                            : undefined,
                        }}
                        onClick={() => handleCellClick(column, row)}
                      >
                        {column.render(row)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {paddingBottom > 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  style={{
                    height: paddingBottom,
                    padding: 0,
                    border: "none",
                  }}
                />
              </tr>
            )}
          </tbody>
        </table>
      </Box>
      <ExpandedTextDialog
        open={!!expandedText}
        onOpenChange={(open) => setExpandedText(open ? expandedText : void 0)}
        textExpanded={expandedText}
      />
    </Box>
  );
}

function stringify(value: any) {
  return typeof value === "object" ? JSON.stringify(value) : `${value}`;
}

function titleCase(text: string) {
  return text
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(val: any) {
  return val !== void 0 && val !== null ? stringify(val) : "-";
}
