import { Box, Button } from "@chakra-ui/react";
import numeral from "numeral";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ESBatchEvaluation } from "../../../server/experiments/types";
import { formatMilliseconds } from "../../../utils/formatMilliseconds";
import { formatMoney } from "../../../utils/formatMoney";
import { useDrawer } from "../../CurrentDrawer";
import { ExternalImage, getImageUrl } from "../../ExternalImage";
import { HoverableBigText } from "../../HoverableBigText";
import { ExpandedTextDialog } from "../../HoverableBigText";
import { AgGridReact } from "@ag-grid-community/react";
import type {
  ColDef,
  ColGroupDef,
  GridApi,
  GridOptions,
  CellClickedEvent,
} from "@ag-grid-community/core";
import { ClientSideRowModelModule } from "@ag-grid-community/client-side-row-model";
import { ModuleRegistry } from "@ag-grid-community/core";
import { getEvaluationColumns } from "./utils";
import "@ag-grid-community/styles/ag-grid.css";
import "@ag-grid-community/styles/ag-theme-balham.css";

ModuleRegistry.registerModules([ClientSideRowModelModule]);

type EvaluationRowData = {
  rowNumber: number;
  datasetEntry?: ESBatchEvaluation["dataset"][number];
  evaluationsForEntry: Record<
    string,
    ESBatchEvaluation["evaluations"][number] | undefined
  >;
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
  results: ESBatchEvaluation["evaluations"];
  datasetByIndex: Record<number, ESBatchEvaluation["dataset"][number]>;
  datasetColumns: Set<string>;
  predictedColumns: Record<string, Set<string>>;
  isFinished: boolean;
  size?: "sm" | "md";
  workflowId: string | null;
}) {
  const evaluatorHeaders = getEvaluationColumns(results);
  const containerRef = useRef<HTMLDivElement>(null);
  const gridApiRef = useRef<GridApi | null>(null);
  const isPinnedToBottomRef = useRef(true);
  const detachViewportScrollListenerRef = useRef<(() => void) | null>(null);
  const { openDrawer } = useDrawer();
  const [expandedText, setExpandedText] = useState<string | undefined>(void 0);

  const totalRows = Math.max(
    ...Object.values(datasetByIndex).map((d) => d.index + 1)
  );

  // Row data
  const rowData = useMemo(
    () =>
      Array.from({ length: totalRows }).map((_, index) => ({
        rowNumber: index + 1,
        datasetEntry: datasetByIndex[index],
        evaluationsForEntry: {
          [evaluator]: results.find((r) => r.index === index),
        },
      })),
    [totalRows, datasetByIndex, evaluator, results]
  );

  // Grid configuration
  const gridOptions: GridOptions = useMemo(
    () => ({
      getRowId: (params) =>
        String((params.data as EvaluationRowData).rowNumber),
      suppressRowClickSelection: true,
      reactiveCustomComponents: true,
      ensureDomOrder: true,
    }),
    []
  );

  const defaultColDef: ColDef = useMemo(
    () => ({
      initialWidth: 160,
      resizable: true,
      sortable: false,
      suppressMenu: true,
      wrapText: false,
      suppressMovable: true,
    }),
    []
  );

  // Column definitions builder
  const buildColumnDefs = useCallback((): (ColDef | ColGroupDef)[] => {
    const colDefs: (ColDef | ColGroupDef)[] = [];

    // Row number
    colDefs.push({
      colId: "rowNumber",
      headerName: "",
      width: 60,
      valueGetter: (p: any) =>
        p.node?.rowIndex != null ? p.node.rowIndex + 1 : "",
      pinned: "left",
    });

    // Dataset columns
    if (datasetColumns.size > 0) {
      const firstEntry = Object.values(datasetByIndex)[0];
      const children: ColDef[] = Array.from(datasetColumns).map((column) => {
        const mightHaveImages =
          typeof firstEntry?.entry?.[column] === "string" &&
          getImageUrl(firstEntry.entry[column]);

        return {
          colId: `dataset_${column}`,
          headerName: `Dataset Input (${column})`,
          minWidth: 150,
          ...(mightHaveImages
            ? {
                cellRenderer: (p: any) => {
                  const val = getRowData(p).datasetEntry?.entry?.[column];
                  const img = getImageUrl(val ?? "");
                  return img ? (
                    <ExternalImage
                      src={img}
                      minWidth="24px"
                      minHeight="24px"
                      maxHeight="120px"
                      maxWidth="100%"
                    />
                  ) : (
                    formatValue(val)
                  );
                },
              }
            : {
                valueGetter: (p: any) =>
                  formatValue(getRowData(p).datasetEntry?.entry?.[column]),
                cellClass: "cell-with-overflow",
              }),
          tooltipValueGetter: (p: any) =>
            stringify(getRowData(p).datasetEntry?.entry?.[column] ?? "-"),
        };
      });
      // Flatten dataset group to avoid any group layout issues
      colDefs.push(...children);
    }

    // Predicted columns
    Object.entries(predictedColumns ?? {}).forEach(([node, columns]) => {
      const children: ColDef[] = Array.from(columns).map((column) => ({
        colId: `predicted_${node}_${column}`,
        headerName: titleCase(column),
        minWidth: 150,
        cellClass: "cell-with-overflow",
        valueGetter: (p: any) => {
          const entry = getRowData(p).datasetEntry;
          if (entry?.error) return "Error";
          let value = (entry?.predicted as any)?.[node]?.[column];
          if (value === void 0 && node === "end")
            value = (entry?.predicted as any)?.[column];
          return formatValue(value);
        },
        tooltipValueGetter: (p: any) => {
          const entry = getRowData(p).datasetEntry;
          if (entry?.error) return entry.error;
          let value = (entry?.predicted as any)?.[node]?.[column];
          if (value === void 0 && node === "end")
            value = (entry?.predicted as any)?.[column];
          return stringify(value ?? "-");
        },
        cellClassRules: {
          "cell-error": (p: any) => !!getRowData(p).datasetEntry?.error,
        },
      }));
      // Flatten predicted group as well to avoid misalignment
      colDefs.push(...children);
    });

    // Evaluation inputs
    if (
      results.length > 0 &&
      evaluatorHeaders.evaluationInputsColumns.size > 0
    ) {
      const children: ColDef[] = Array.from(
        evaluatorHeaders.evaluationInputsColumns
      ).map((column) => ({
        colId: `eval_input_${column}`,
        headerName: titleCase(column),
        minWidth: 150,
        cellClass: "cell-with-overflow",
        valueGetter: (p: any) => {
          const { datasetEntry, evaluationsForEntry } = getRowData(p);

          if (datasetEntry?.error) return "Error";
          const value = evaluationsForEntry[evaluator]?.inputs?.[column];

          return evaluationsForEntry[evaluator] ? stringify(value ?? "-") : "-";
        },
        tooltipValueGetter: (p: any) => {
          const { datasetEntry, evaluationsForEntry } = getRowData(p);
          if (datasetEntry?.error) return datasetEntry.error;
          return stringify(
            evaluationsForEntry[evaluator]?.inputs?.[column] ?? "-"
          );
        },
        cellClassRules: {
          "cell-error": (p: any) => !!getRowData(p).datasetEntry?.error,
        },
      }));
      // Flatten evaluation inputs group to avoid misalignment
      colDefs.push(...children);
    }

    // Cost column (standalone after groups)
    colDefs.push({
      colId: "cost",
      headerName: "Cost",
      minWidth: 120,
      cellClass: "cell-with-overflow",
      valueGetter: (p: any) => {
        const { datasetEntry, evaluationsForEntry } = getRowData(p);
        const total =
          (datasetEntry?.cost ?? 0) +
          (evaluationsForEntry[evaluator]?.cost ?? 0);
        return total || "-";
      },
      valueFormatter: (p: any) =>
        p.value === "-"
          ? "-"
          : formatMoney({ amount: p.value, currency: "USD" }, "$0.00[00]"),
      tooltipValueGetter: (p: any) => {
        const { datasetEntry, evaluationsForEntry } = getRowData(p);
        const predCost = datasetEntry?.cost ?? 0;
        const evalCost = evaluationsForEntry[evaluator]?.cost ?? 0;
        const total = predCost + evalCost;
        if (!total) return "-";
        const fmt = (v: number) =>
          formatMoney({ amount: v, currency: "USD" }, "$0.00[00]");
        return `Prediction: ${predCost ? fmt(predCost) : "-"}, Evaluation: ${
          evalCost ? fmt(evalCost) : "-"
        }`;
      },
    });

    // Duration column (standalone after cost)
    colDefs.push({
      colId: "duration",
      headerName: "Duration",
      minWidth: 120,
      cellClass: "cell-with-overflow",
      valueGetter: (p: any) => {
        const { datasetEntry, evaluationsForEntry } = getRowData(p);
        const total =
          (datasetEntry?.duration ?? 0) +
          (evaluationsForEntry[evaluator]?.duration ?? 0);
        return total || "-";
      },
      valueFormatter: (p: any) =>
        p.value === "-" ? "-" : formatMilliseconds(p.value),
      tooltipValueGetter: (p: any) => {
        const { datasetEntry, evaluationsForEntry } = getRowData(p);
        const predDur = datasetEntry?.duration ?? 0;
        const evalDur = evaluationsForEntry[evaluator]?.duration ?? 0;
        const total = predDur + evalDur;
        if (!total) return "-";
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
      (c) => evaluatorHeaders.evaluationResultsColumns.has(c)
    );

    evaluationResultsColumnsOrdered.forEach((column) => {
      const isDetails = column === "details";
      const formatEvalValue = (value: any) => {
        if (value === false) return "false";
        if (value === true) return "true";
        return !isNaN(Number(value))
          ? numeral(Number(value)).format("0.[00]")
          : value ?? "-";
      };

      colDefs.push({
        colId: `eval_result_${column}`,
        headerName: titleCase(column),
        minWidth: isDetails ? 240 : 120,
        ...(isDetails
          ? {
              cellRenderer: (p: any) => {
                const evaluation = getRowData(p).evaluationsForEntry[
                  evaluator
                ] as Record<string, any> | undefined;
                return (
                  <HoverableBigText
                    lineClamp={3}
                    maxWidth="300px"
                    whiteSpace="pre-wrap"
                  >
                    {evaluation?.[column]}
                  </HoverableBigText>
                );
              },
            }
          : {
              cellClass: "cell-with-overflow",
              valueGetter: (p: any) => {
                const evaluation = getRowData(p).evaluationsForEntry[
                  evaluator
                ] as Record<string, any> | undefined;
                if (evaluation?.status === "error") return "Error";
                if (evaluation?.status === "skipped") return "Skipped";
                return formatEvalValue(evaluation?.[column]);
              },
            }),
        tooltipValueGetter: (p: any) => {
          const evaluation = getRowData(p).evaluationsForEntry[evaluator] as
            | Record<string, any>
            | undefined;
          if (!isDetails && evaluation?.status === "error")
            return evaluation?.details ?? "Error";
          if (!isDetails && evaluation?.status === "skipped")
            return evaluation?.details ?? "Skipped";
          return formatEvalValue(evaluation?.[column]);
        },
        cellClassRules: {
          "cell-error": (p: any) =>
            !isDetails &&
            getRowData(p).evaluationsForEntry[evaluator]?.status === "error",
          "cell-skipped": (p: any) =>
            !isDetails &&
            getRowData(p).evaluationsForEntry[evaluator]?.status === "skipped",
          "cell-true": (p: any) => {
            const ev = getRowData(p).evaluationsForEntry[evaluator] as
              | Record<string, any>
              | undefined;
            return ev?.[column] === true;
          },
          "cell-false": (p: any) => {
            const ev = getRowData(p).evaluationsForEntry[evaluator] as
              | Record<string, any>
              | undefined;
            return ev?.[column] === false;
          },
        },
      });
    });

    // Trace column
    const hasAnyTraceId = Object.values(datasetByIndex).some(
      (d) => d.trace_id && d.trace_id !== "0"
    );
    if (hasAnyTraceId) {
      colDefs.push({
        colId: "trace",
        headerName: "Trace",
        minWidth: 90,
        cellRenderer: (p: any) => {
          const traceId = getRowData(p).datasetEntry?.trace_id;
          return traceId ? (
            <Button
              size="xs"
              colorPalette="gray"
              onClick={(e) => {
                e.preventDefault();
                openDrawer("traceDetails", {
                  traceId,
                  selectedTab: "traceDetails",
                });
              }}
            >
              View
            </Button>
          ) : (
            "-"
          );
        },
      });
    }

    return colDefs;
  }, [
    datasetColumns,
    predictedColumns,
    results.length,
    evaluatorHeaders,
    evaluator,
    openDrawer,
    datasetByIndex,
  ]);

  const columnDefs = useMemo(() => buildColumnDefs(), [buildColumnDefs]);

  // Attach scroll listener to grid viewport to detect if user is near the bottom
  useEffect(() => {
    const attachViewportScrollListener = () => {
      const container = containerRef.current;
      if (!container) return;
      const viewportEl = container.querySelector(".ag-body-viewport");
      if (!viewportEl || !(viewportEl instanceof HTMLElement)) return;

      // Clean up previous listener if any
      detachViewportScrollListenerRef.current?.();

      const onScroll = () => {
        const atBottom =
          viewportEl.scrollTop + viewportEl.clientHeight >=
          viewportEl.scrollHeight - 24;
        isPinnedToBottomRef.current = atBottom;
      };

      // Initialize current state
      onScroll();

      viewportEl.addEventListener("scroll", onScroll, { passive: true });
      detachViewportScrollListenerRef.current = () =>
        viewportEl.removeEventListener("scroll", onScroll);
    };

    // Try attaching immediately (in case grid already rendered)
    attachViewportScrollListener();

    // Also attempt after a brief delay to catch grid mount
    const t = setTimeout(attachViewportScrollListener, 100);

    return () => {
      clearTimeout(t);
      detachViewportScrollListenerRef.current?.();
    };
  }, []);

  // Handle cell click to show expanded text dialog
  const handleCellClicked = useCallback(
    (event: CellClickedEvent) => {
      // Skip for row number and trace button
      const colId = event.column.getColId();
      if (colId === "rowNumber" || colId === "trace") return;

      // Get the cell value
      const value = event.value;
      if (!value || value === "-") return;

      // Show the expanded text dialog
      setExpandedText(stringify(value));
    },
    []
  );

  // Auto-scroll to bottom only if user is pinned to bottom
  useEffect(() => {
    if (!gridApiRef.current || !isPinnedToBottomRef.current) return;

    const lastIndex = totalRows - 1;
    setTimeout(
      () => gridApiRef.current?.ensureIndexVisible(lastIndex, "bottom"),
      100
    );
    setTimeout(
      () => gridApiRef.current?.ensureIndexVisible(lastIndex, "bottom"),
      1000
    );
  }, [totalRows]);

  return (
    <Box ref={containerRef}>
      <div
        className="ag-theme-balham"
        style={{ width: "100%", height: "60vh" }}
      >
        <style>{`
          .ag-theme-balham .ag-root-wrapper { border: none !important; border-radius: 0 !important; box-shadow: none !important; }
          .ag-theme-balham .ag-root-wrapper-body { border-radius: 0 !important; }
          .ag-theme-balham .ag-cell { cursor: pointer; }

          .ag-theme-balham .cell-with-overflow {
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
          }

          .ag-theme-balham .cell-with-overflow:hover::after {
            content: "⤢";
            position: absolute;
            right: 3px;
            top: 50%;
            border: 1px solid #1f1f1f;
            font-size: 16px;
            width: 20px;
            height: 20px;
            text-align: center;
            transform: translateY(-50%);
            color: #1f1f1f;
            pointer-events: none;
            line-height: 1;
            border-radius: 4px;
            padding: 0px 4px;
            background: white;
          }

          .cell-error { background: rgba(255, 0, 0, 0.2); }
          .cell-skipped { background: rgba(255, 255, 0, 0.2); }
          .cell-true { background: rgba(0, 128, 0, 0.15); }
          .cell-false { background: rgba(255, 0, 0, 0.15); }
        `}</style>

        <AgGridReact
          gridOptions={gridOptions}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          rowData={rowData}
          rowHeight={size === "sm" ? 28 : 34}
          rowBuffer={10}
          suppressAnimationFrame={false}
          onGridReady={(p) => {
            gridApiRef.current = p.api;
            // When grid is ready, re-evaluate bottom state soon after render
            setTimeout(() => {
              const container = containerRef.current;
              const viewportEl = container?.querySelector(".ag-body-viewport");
              if (viewportEl instanceof HTMLElement) {
                const atBottom =
                  viewportEl.scrollTop + viewportEl.clientHeight >=
                  viewportEl.scrollHeight - 24;
                isPinnedToBottomRef.current = atBottom;
              }
            }, 50);
          }}
          onCellClicked={handleCellClicked}
        />
      </div>
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

function getRowData(p: any) {
  return p.data as EvaluationRowData;
}

function formatValue(val: any) {
  return val !== void 0 && val !== null ? stringify(val) : "-";
}
