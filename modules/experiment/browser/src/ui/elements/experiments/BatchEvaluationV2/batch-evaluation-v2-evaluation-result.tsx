/**
 * Read-only, virtualized results table for a batch evaluation run: inputs,
 * outputs, cost/duration, score/passed/label/details; auto-pins to the
 * bottom while streaming, click-to-expand cells, error/skipped tinting.
 */
import { Box, Button, HStack } from "@chakra-ui/react";
import { useDrawer } from "@langwatch/browser-host/use-drawer";
import { formatMilliseconds } from "@langwatch/design-system/format-milliseconds";
import { formatMoney } from "@langwatch/design-system/format-money";
import { cellPictureUrl } from "@langwatch/experiment-browser-kit";
import type { ExperimentRunWithItems } from "@langwatch/experiment-contract";
import { StoredObjectImage } from "@langwatch/stored-object-browser-kit";
import { useVirtualizer } from "@tanstack/react-virtual";
import numeral from "numeral";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { HoverableBigText } from "../../../../behavior/lent-hoverable-big-text.tsx";
import { TraceIdPeek } from "../../../../behavior/lent-trace.tsx";
import {
  cellText,
  getEvaluationColumns,
  readKey,
} from "../../../../model/experiments/BatchEvaluationV2/utils.ts";
import { ExpandedTextDialog } from "../../expanded-text-dialog.tsx";

type EvaluationRowData = {
  rowNumber: number;
  datasetEntry?: ExperimentRunWithItems["dataset"][number];
  evaluationsForEntry: Record<string, ExperimentRunWithItems["evaluations"][number] | undefined>;
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

/** The row-number column. */
const rowNumberColumn = (): ResultColumn => {
  return {
    id: "rowNumber",
    header: "",
    minWidth: 60,
    render: (row) => row.rowNumber,
    text: () => undefined,
  };
};

/** One dataset input column; a column whose first value is a picture renders pictures. */
const datasetColumn = ({
  column,
  mightHaveImages,
  rowHeight,
}: {
  column: string;
  mightHaveImages: boolean;
  rowHeight: number;
}): ResultColumn => {
  return {
    id: `dataset_${column}`,
    header: `Dataset Input (${column})`,
    minWidth: 150,
    render: (row) => {
      const val = row.datasetEntry?.entry?.[column];
      if (mightHaveImages) {
        const img = cellPictureUrl(val);
        if (img) {
          return (
            <StoredObjectImage
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
    text: (row) => cellText(row.datasetEntry?.entry?.[column] ?? "-"),
  };
};

/** One predicted output column; an entry's error stands in for its value. */
const predictedColumn = ({ node, column }: { node: string; column: string }): ResultColumn => {
  const predictedValue = (row: EvaluationRowData) => {
    const entry = row.datasetEntry;
    if (entry?.error) return entry.error;
    let value = readKey(entry?.predicted?.[node], column);
    if (value === void 0 && node === "end") value = entry?.predicted?.[column];
    return value;
  };
  return {
    id: `predicted_${node}_${column}`,
    header: titleCase(column),
    minWidth: 150,
    render: (row) => formatValue(predictedValue(row)),
    text: (row) => cellText(predictedValue(row) ?? "-"),
    cellState: (row) => (row.datasetEntry?.error ? "error" : undefined),
  };
};

/** One column of what the evaluator was given. */
const evaluationInputColumn = ({
  column,
  evaluator,
}: {
  column: string;
  evaluator: string;
}): ResultColumn => {
  return {
    id: `eval_input_${column}`,
    header: titleCase(column),
    minWidth: 150,
    render: (row) => {
      const { datasetEntry, evaluationsForEntry } = row;
      if (datasetEntry?.error) return "Error";
      const value = evaluationsForEntry[evaluator]?.inputs?.[column];
      return evaluationsForEntry[evaluator] ? cellText(value ?? "-") : "-";
    },
    text: (row) => {
      if (row.datasetEntry?.error) return row.datasetEntry.error;
      return cellText(row.evaluationsForEntry[evaluator]?.inputs?.[column] ?? "-");
    },
    cellState: (row) => (row.datasetEntry?.error ? "error" : undefined),
  };
};

/** Prediction plus evaluation cost, split in the copied text. */
const costColumn = (evaluator: string): ResultColumn => {
  return {
    id: "cost",
    header: "Cost",
    minWidth: 120,
    render: (row) => {
      const total = (row.datasetEntry?.cost ?? 0) + (row.evaluationsForEntry[evaluator]?.cost ?? 0);
      return total ? formatMoney({ amount: total, currency: "USD" }, "$0.00[00]") : "-";
    },
    text: (row) => {
      const predCost = row.datasetEntry?.cost ?? 0;
      const evalCost = row.evaluationsForEntry[evaluator]?.cost ?? 0;
      if (!predCost && !evalCost) return "-";
      const fmt = (v: number) => formatMoney({ amount: v, currency: "USD" }, "$0.00[00]");
      return `Prediction: ${predCost ? fmt(predCost) : "-"}, Evaluation: ${
        evalCost ? fmt(evalCost) : "-"
      }`;
    },
  };
};

/** Prediction plus evaluation duration, split in the copied text. */
const durationColumn = (evaluator: string): ResultColumn => {
  return {
    id: "duration",
    header: "Duration",
    minWidth: 120,
    render: (row) => {
      const total =
        (row.datasetEntry?.duration ?? 0) + (row.evaluationsForEntry[evaluator]?.duration ?? 0);
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
  };
};

const EVAL_RESULT_ORDER = ["score", "passed", "label", "details"] as const;
type EvalResultColumn = (typeof EVAL_RESULT_ORDER)[number];

type RowEvaluation = ExperimentRunWithItems["evaluations"][number] | undefined;

const formatEvalValue = (value: NonNullable<RowEvaluation>[EvalResultColumn] | undefined) => {
  if (value === false) return "false";
  if (value === true) return "true";
  return !Number.isNaN(Number(value)) ? numeral(Number(value)).format("0.[00]") : (value ?? "-");
};

/** A score, passed or label cell: an error or a skip says so instead of a value. */
const verdictCell = (evaluation: RowEvaluation, column: EvalResultColumn): ReactNode => {
  if (evaluation?.status === "error") return "Error";
  if (evaluation?.status === "skipped") return "Skipped";
  return formatEvalValue(evaluation?.[column]);
};

/** A verdict cell's copied text: an error or a skip copies its details. */
const verdictText = (evaluation: RowEvaluation, column: EvalResultColumn): string => {
  if (evaluation?.status === "error") return evaluation.details ?? "Error";
  if (evaluation?.status === "skipped") return evaluation.details ?? "Skipped";
  return `${formatEvalValue(evaluation?.[column])}`;
};

/** A verdict cell's tint: error, skipped, or the boolean it shows. */
const verdictState = (evaluation: RowEvaluation, column: EvalResultColumn): CellState => {
  if (evaluation?.status === "error") return "error";
  if (evaluation?.status === "skipped") return "skipped";
  if (evaluation?.[column] === true) return "true";
  if (evaluation?.[column] === false) return "false";
  return undefined;
};

/** One evaluation result column: score, passed, label, or the details text. */
const evaluationResultColumn = ({
  column,
  evaluator,
}: {
  column: EvalResultColumn;
  evaluator: string;
}): ResultColumn => {
  const evaluationOf = (row: EvaluationRowData): RowEvaluation =>
    row.evaluationsForEntry[evaluator];
  if (column === "details") {
    return {
      id: `eval_result_${column}`,
      header: titleCase(column),
      minWidth: 240,
      render: (row) => (
        <HoverableBigText lineClamp={1} maxWidth="300px" whiteSpace="pre-wrap">
          {evaluationOf(row)?.[column]}
        </HoverableBigText>
      ),
      text: (row) => `${formatEvalValue(evaluationOf(row)?.[column])}`,
      cellState: () => undefined,
    };
  }
  return {
    id: `eval_result_${column}`,
    header: titleCase(column),
    minWidth: 120,
    render: (row) => verdictCell(evaluationOf(row), column),
    text: (row) => verdictText(evaluationOf(row), column),
    cellState: (row) => verdictState(evaluationOf(row), column),
  };
};

/** Opens a row's trace. */
const traceColumn = (openTrace: (traceId: string) => void): ResultColumn => {
  return {
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
              openTrace(traceId);
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
  };
};

/**
 * Keeps a live run's table scrolled to its newest rows while the reader stays at the
 * bottom; scrolling up stops it following.
 */
const useLiveAutoscroll = ({
  containerRef,
  streamKey,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  streamKey: string;
}) => {
  const isPinnedToBottomRef = useRef(true);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onScroll = () => {
      isPinnedToBottomRef.current =
        container.scrollTop + container.clientHeight >= container.scrollHeight - 24;
    };
    onScroll();
    container.addEventListener("scroll", onScroll, { passive: true });
    return () => container.removeEventListener("scroll", onScroll);
  }, [containerRef]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isPinnedToBottomRef.current) return;
    const t = setTimeout(() => {
      container.scrollTop = container.scrollHeight;
    }, 100);
    return () => clearTimeout(t);
  }, [streamKey, containerRef]);
};

/** The virtualized list's spacer above or below the rendered rows. */
function SpacerRow({ height, colSpan }: { height: number; colSpan: number }) {
  if (height <= 0) return null;
  return (
    <tr>
      <td aria-hidden="true" colSpan={colSpan} style={{ height, padding: 0, border: "none" }} />
    </tr>
  );
}

/** One result row; a cell's copied text is its tooltip unless it is very long. */
function ResultRow({
  index,
  row,
  columns,
  onCellClick,
}: {
  index: number;
  row: EvaluationRowData;
  columns: ResultColumn[];
  onCellClick: (column: ResultColumn, row: EvaluationRowData) => void;
}) {
  return (
    <tr data-index={index}>
      {columns.map((column) => {
        const state = column.cellState?.(row);
        const tooltip = column.text?.(row);
        return (
          <td
            key={column.id}
            title={tooltip && tooltip.length < 1000 ? tooltip : undefined}
            style={{
              minWidth: column.minWidth,
              background: state ? CELL_STATE_BG[state] : undefined,
            }}
            onClick={() => onCellClick(column, row)}
          >
            {column.render(row)}
          </td>
        );
      })}
    </tr>
  );
}

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
  const { openDrawer } = useDrawer();
  const [expandedText, setExpandedText] = useState<string | undefined>(void 0);

  const rowHeight = size === "sm" ? 28 : 34;

  const totalRows = Math.max(...Object.values(datasetByIndex).map((d) => d.index + 1), 0);

  const rowData = useMemo(() => {
    const resultsByIndex = new Map(results.map((r) => [r.index, r]));
    return Array.from({ length: totalRows }).map((_, index) => ({
      rowNumber: index + 1,
      datasetEntry: datasetByIndex[index],
      evaluationsForEntry: {
        [evaluator]: resultsByIndex.get(index),
      },
    }));
  }, [totalRows, datasetByIndex, evaluator, results]);

  const columns = useMemo((): ResultColumn[] => {
    const firstEntry = Object.values(datasetByIndex)[0];
    const hasAnyTraceId = Object.values(datasetByIndex).some((d) => d.traceId && d.traceId !== "0");
    const showInputs = results.length > 0 && evaluatorHeaders.evaluationInputsColumns.size > 0;
    return [
      rowNumberColumn(),
      ...[...datasetColumns].map((column) =>
        datasetColumn({
          column,
          mightHaveImages: cellPictureUrl(firstEntry?.entry?.[column]) !== null,
          rowHeight,
        }),
      ),
      ...Object.entries(predictedColumns ?? {}).flatMap(([node, nodeColumns]) =>
        [...nodeColumns].map((column) => predictedColumn({ node, column })),
      ),
      ...(showInputs
        ? [...evaluatorHeaders.evaluationInputsColumns].map((column) =>
            evaluationInputColumn({ column, evaluator }),
          )
        : []),
      costColumn(evaluator),
      durationColumn(evaluator),
      ...EVAL_RESULT_ORDER.filter((c) => evaluatorHeaders.evaluationResultsColumns.has(c)).map(
        (column) => evaluationResultColumn({ column, evaluator }),
      ),
      ...(hasAnyTraceId
        ? [traceColumn((traceId) => openDrawer("traceV2Details", { traceId }))]
        : []),
    ];
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

  useLiveAutoscroll({ containerRef, streamKey: `${totalRows}:${results.length}` });

  const rowVirtualizer = useVirtualizer({
    count: rowData.length,
    getScrollElement: () => containerRef.current,
    estimateSize: useCallback(() => rowHeight, [rowHeight]),
    overscan: 20,
  });

  const handleCellClick = useCallback((column: ResultColumn, row: EvaluationRowData) => {
    const value = column.text?.(row);
    if (!value || value === "-") return;
    setExpandedText(value);
  }, []);

  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualRows.length > 0 ? (virtualRows[0]?.start ?? 0) : 0;
  const paddingBottom =
    virtualRows.length > 0
      ? rowVirtualizer.getTotalSize() - (virtualRows[virtualRows.length - 1]?.end ?? 0)
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
            <SpacerRow height={paddingTop} colSpan={columns.length} />
            {virtualRows.map((virtualRow) => {
              const row = rowData[virtualRow.index];
              if (!row) return null;
              return (
                <ResultRow
                  key={virtualRow.index}
                  index={virtualRow.index}
                  row={row}
                  columns={columns}
                  onCellClick={handleCellClick}
                />
              );
            })}
            <SpacerRow height={paddingBottom} colSpan={columns.length} />
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

function titleCase(text: string) {
  return text
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatValue(val: unknown) {
  return val !== void 0 && val !== null ? cellText(val) : "-";
}
