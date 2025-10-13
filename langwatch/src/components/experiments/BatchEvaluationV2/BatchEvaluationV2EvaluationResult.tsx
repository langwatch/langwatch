import { Box, Button, VStack } from "@chakra-ui/react";
import numeral from "numeral";
import { useEffect, useRef } from "react";
import { Tooltip } from "../../../components/ui/tooltip";
import type { ESBatchEvaluation } from "../../../server/experiments/types";
import { formatMilliseconds } from "../../../utils/formatMilliseconds";
import { formatMoney } from "../../../utils/formatMoney";
import { useDrawer } from "../../CurrentDrawer";
import { ExternalImage, getImageUrl } from "../../ExternalImage";
import { HoverableBigText } from "../../HoverableBigText";
import { AgGridReact } from "@ag-grid-community/react";
import type {
  ColDef,
  ColGroupDef,
  GridApi,
  GridOptions,
} from "@ag-grid-community/core";
import { ClientSideRowModelModule } from "@ag-grid-community/client-side-row-model";
import { ModuleRegistry } from "@ag-grid-community/core";
import { getEvaluationColumns } from "./utils";
import "@ag-grid-community/styles/ag-grid.css";
import "@ag-grid-community/styles/ag-theme-balham.css";

ModuleRegistry.registerModules([ClientSideRowModelModule]);


export function BatchEvaluationV2EvaluationResult({
  evaluator,
  results,
  datasetByIndex,
  datasetColumns,
  predictedColumns,
  isFinished,
  size = "md",
  hasScrolled,
  workflowId: _workflowId,
}: {
  evaluator: string;
  results: ESBatchEvaluation["evaluations"];
  datasetByIndex: Record<number, ESBatchEvaluation["dataset"][number]>;
  datasetColumns: Set<string>;
  predictedColumns: Record<string, Set<string>>;
  isFinished: boolean;
  size?: "sm" | "md";
  hasScrolled: boolean;
  workflowId: string | null;
}) {
  const evaluatorHeaders = getEvaluationColumns(results);

  // Container ref for grid
  const containerRef = useRef<HTMLDivElement>(null);

  const { openDrawer } = useDrawer();

  type EvaluationRowData = {
    rowNumber: number;
    datasetEntry?: ESBatchEvaluation["dataset"][number];
    evaluationsForEntry: Record<
      string,
      ESBatchEvaluation["evaluations"][number] | undefined
    >;
  };

  const totalRows = Math.max(
    ...Object.values(datasetByIndex).map((d) => d.index + 1)
  );

  const rowData: EvaluationRowData[] = Array.from({ length: totalRows }).map(
    (_, index) => {
      const datasetEntry = datasetByIndex[index];
      const evaluationsForEntry = Object.fromEntries(
        Object.entries({ [evaluator]: results }).map(([ev, res]) => [
          ev,
          res.find((r) => r.index === index),
        ])
      );
      return {
        rowNumber: index + 1,
        datasetEntry,
        evaluationsForEntry,
      };
    }
  );

  const gridApiRef = useRef<GridApi | null>(null);

  const gridOptions: GridOptions = {
    getRowId: (params) => String((params.data as EvaluationRowData).rowNumber),
    suppressRowClickSelection: true,
  };

  const defaultColDef: ColDef = {
    resizable: true,
    sortable: false,
    suppressMenu: true,
    wrapText: false,
  };

  const stringify = (value: any) =>
    typeof value === "object" ? JSON.stringify(value) : `${value}`;
  const titleCase = (text: string) =>
    text
      .replace(/[_-]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase());

  const buildColumnDefs = (): (ColDef | ColGroupDef)[] => {
    const colDefs: (ColDef | ColGroupDef)[] = [];

    // Row number column
    colDefs.push({
      headerName: "",
      width: 60,
      valueGetter: (p: any) =>
        p.node?.rowIndex != null ? p.node.rowIndex + 1 : "",
      pinned: "left",
    });

    // Dataset columns group
    if (datasetColumns.size > 0) {
      const children: ColDef[] = Array.from(datasetColumns).map((column) => ({
        headerName: titleCase(column),
        minWidth: 150,
        cellRenderer: (p: any) => {
          const data = p.data as EvaluationRowData;
          const entry = data.datasetEntry;
          const val = entry?.entry?.[column];
          const img = getImageUrl(entry?.entry?.[column] ?? "");

          return img ? (
            <ExternalImage
              src={img}
              minWidth="24px"
              minHeight="24px"
              maxHeight="120px"
              maxWidth="100%"
            />
          ) : val !== undefined && val !== null ? (
            <HoverableBigText>{stringify(val)}</HoverableBigText>
          ) : (
            "-"
          );
        },
        tooltipValueGetter: (p: any) => {
          const data = p.data as EvaluationRowData;
          const entry = data.datasetEntry;
          const val = entry?.entry?.[column];
          return stringify(val ?? "-");
        },
      }));
      colDefs.push({ headerName: "Dataset", children });
    }

    // Predicted columns grouped by node
    Object.entries(predictedColumns ?? {}).forEach(([node, columns]) => {
      const children: ColDef[] = Array.from(columns).map((column) => ({
        headerName: titleCase(column),
        minWidth: 150,
        cellRenderer: (p: any) => {
          const data = p.data as EvaluationRowData;
          const entry = data.datasetEntry;
          if (entry?.error) {
            return (
              <Tooltip content={entry.error} positioning={{ placement: "top" }}>
                <Box lineClamp={1}>Error</Box>
              </Tooltip>
            );
          }

          let value = (entry?.predicted as any)?.[node]?.[column];
          if (value === undefined && node === "end") {
            value = (entry?.predicted as any)?.[column];
          }

          return value !== undefined && value !== null ? (
            <HoverableBigText>{stringify(value)}</HoverableBigText>
          ) : (
            "-"
          );
        },
        tooltipValueGetter: (p: any) => {
          const data = p.data as EvaluationRowData;
          const entry = data.datasetEntry;
          if (entry?.error) return entry.error;
          let value = (entry?.predicted as any)?.[node]?.[column];

          if (value === undefined && node === "end") {
            value = (entry?.predicted as any)?.[column];
          }

          return stringify(value ?? "-");
        },
        cellClassRules: {
          "cell-error": (p: any) =>
            !!(p.data as EvaluationRowData)?.datasetEntry?.error,
        },
      }));

      colDefs.push({ headerName: titleCase(node), children });
    });

    // Evaluation Data group (inputs)
    if (
      results.length > 0 &&
      evaluatorHeaders.evaluationInputsColumns.size > 0
    ) {
      const children: ColDef[] = Array.from(
        evaluatorHeaders.evaluationInputsColumns
      ).map((column) => ({
        headerName: titleCase(column),
        minWidth: 150,
        cellRenderer: (p: any) => {
          const data = p.data as EvaluationRowData;
          const entry = data.datasetEntry;
          const evaluation = data.evaluationsForEntry[evaluator];

          if (entry?.error) {
            return (
              <Tooltip content={entry.error} positioning={{ placement: "top" }}>
                <Box lineClamp={1}>Error</Box>
              </Tooltip>
            );
          }

          const value = evaluation?.inputs?.[column];

          return evaluation ? (
            <HoverableBigText>{stringify(value ?? "-")}</HoverableBigText>
          ) : (
            "-"
          );
        },
        tooltipValueGetter: (p: any) => {
          const data = p.data as EvaluationRowData;
          const entry = data.datasetEntry;
          const evaluation = data.evaluationsForEntry[evaluator];

          if (entry?.error) return entry.error;

          return stringify(evaluation?.inputs?.[column] ?? "-");
        },
        cellClassRules: {
          "cell-error": (p: any) =>
            !!(p.data as EvaluationRowData)?.datasetEntry?.error,
        },
      }));
      colDefs.push({ headerName: "Evaluation Data", children });
    }

    // Cost column
    colDefs.push({
      headerName: "Cost",
      minWidth: 120,
      cellRenderer: (p: any) => {
        const data = p.data as EvaluationRowData;
        const entry = data.datasetEntry;
        const evaluation = data.evaluationsForEntry[evaluator];
        const evaluationsCost = evaluation?.cost ?? 0;
        const total = (entry?.cost ?? 0) + (evaluationsCost ?? 0);
        const content = (
          <VStack align="start" gap={0}>
            <Box>Prediction cost: {entry?.cost ?? "-"}</Box>
            <Box>Evaluation cost: {evaluationsCost ?? "-"}</Box>
          </VStack>
        );

        return (
          <Tooltip content={content} positioning={{ placement: "top" }}>
            {!!entry?.cost || !!evaluationsCost
              ? formatMoney({ amount: total, currency: "USD" }, "$0.00[00]")
              : "-"}
          </Tooltip>
        );
      },
      tooltipValueGetter: (p: any) => {
        const data = p.data as EvaluationRowData;
        const entry = data.datasetEntry;
        const evaluation = data.evaluationsForEntry[evaluator];
        const evaluationsCost = evaluation?.cost ?? 0;
        const total = (entry?.cost ?? 0) + (evaluationsCost ?? 0);

        return total ? `${total}` : "-";
      },
    });

    // Duration column
    colDefs.push({
      headerName: "Duration",
      minWidth: 120,
      cellRenderer: (p: any) => {
        const data = p.data as EvaluationRowData;
        const entry = data.datasetEntry;
        const evaluation = data.evaluationsForEntry[evaluator];
        const evaluationsDuration = evaluation?.duration ?? 0;
        const total = (entry?.duration ?? 0) + (evaluationsDuration ?? 0);
        const content = (
          <VStack align="start" gap={0}>
            <Box>
              Prediction duration:{" "}
              {entry?.duration ? formatMilliseconds(entry.duration) : "-"}
            </Box>
            <Box>
              Evaluation duration:{" "}
              {evaluationsDuration
                ? formatMilliseconds(evaluationsDuration)
                : "-"}
            </Box>
          </VStack>
        );

        return (
          <Tooltip content={content} positioning={{ placement: "top" }}>
            {!!entry?.duration || !!evaluationsDuration
              ? formatMilliseconds(total)
              : "-"}
          </Tooltip>
        );
      },
      tooltipValueGetter: (p: any) => {
        const data = p.data as EvaluationRowData;
        const entry = data.datasetEntry;
        const evaluation = data.evaluationsForEntry[evaluator];
        const evaluationsDuration = evaluation?.duration ?? 0;
        const total = (entry?.duration ?? 0) + (evaluationsDuration ?? 0);

        return total ? `${total}` : "-";
      },
    });

    // Evaluation Results columns
    Array.from(evaluatorHeaders.evaluationResultsColumns).forEach((column) => {
      colDefs.push({
        headerName: titleCase(column),
        minWidth: column === "details" ? 240 : 120,
        cellRenderer: (p: any) => {
          const data = p.data as EvaluationRowData;
          const evaluation = data.evaluationsForEntry[evaluator] as
            | Record<string, any>
            | undefined;
          if (column !== "details" && evaluation?.status === "error") {
            return (
              <Tooltip
                content={evaluation?.details}
                positioning={{ placement: "top" }}
              >
                <Box lineClamp={1}>Error</Box>
              </Tooltip>
            );
          }
          if (column !== "details" && evaluation?.status === "skipped") {
            return (
              <Tooltip
                content={evaluation?.details}
                positioning={{ placement: "top" }}
              >
                <Box lineClamp={1}>Skipped</Box>
              </Tooltip>
            );
          }
          const value = evaluation?.[column];
          if (column === "details") {
            return (
              <HoverableBigText
                lineClamp={3}
                maxWidth="300px"
                whiteSpace="pre-wrap"
              >
                {value}
              </HoverableBigText>
            );
          }
          if (value === false) return "false";
          if (value === true) return "true";
          return !isNaN(Number(value))
            ? numeral(Number(value)).format("0.[00]")
            : value ?? "-";
        },
        tooltipValueGetter: (p: any) => {
          const data = p.data as EvaluationRowData;
          const evaluation = data.evaluationsForEntry[evaluator] as
            | Record<string, any>
            | undefined;
          if (column !== "details" && evaluation?.status === "error")
            return "Error";
          if (column !== "details" && evaluation?.status === "skipped")
            return "Skipped";
          const value = evaluation?.[column];
          if (value === false) return "false";
          if (value === true) return "true";
          return !isNaN(Number(value))
            ? numeral(Number(value)).format("0.[00]")
            : stringify(value ?? "");
        },
        cellClassRules: {
          "cell-error": (p: any) =>
            (p.data as EvaluationRowData)?.evaluationsForEntry?.[evaluator]
              ?.status === "error" && column !== "details",
          "cell-skipped": (p: any) =>
            (p.data as EvaluationRowData)?.evaluationsForEntry?.[evaluator]
              ?.status === "skipped" && column !== "details",
          "cell-true": (p: any) => {
            const ev = (p.data as EvaluationRowData)?.evaluationsForEntry?.[
              evaluator
            ] as Record<string, unknown> | undefined;
            return ev ? (ev as any)[column] === true : false;
          },
          "cell-false": (p: any) => {
            const ev = (p.data as EvaluationRowData)?.evaluationsForEntry?.[
              evaluator
            ] as Record<string, unknown> | undefined;
            return ev ? (ev as any)[column] === false : false;
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
        headerName: "Trace",
        minWidth: 90,
        cellRenderer: (p: any) => {
          const data = p.data as EvaluationRowData;
          const traceId = data.datasetEntry?.trace_id;
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
  };

  const columnDefs = buildColumnDefs();
  const rowHeight = size === "sm" ? 28 : 34;

  useEffect(() => {
    const container = containerRef.current;
    let isAtBottom = true;
    const scrollParent = container?.parentElement?.parentElement;

    if (scrollParent) {
      const currentScrollTop = scrollParent.scrollTop;
      const scrollParentHeight = scrollParent.clientHeight;

      isAtBottom =
        currentScrollTop + scrollParentHeight + 32 >= scrollParent.scrollHeight;
    }
    if ((isAtBottom || (!hasScrolled && !isFinished)) && gridApiRef.current) {
      const lastIndex = totalRows - 1;

      setTimeout(
        () => gridApiRef.current?.ensureIndexVisible(lastIndex, "bottom"),
        100
      );
      setTimeout(
        () => gridApiRef.current?.ensureIndexVisible(lastIndex, "bottom"),
        1000
      );
    }
  }, [results, isFinished, hasScrolled, totalRows]);

  return (
    <Box ref={containerRef}>
      <div
        className="ag-theme-balham"
        style={{ width: "100%", height: "60vh" }}
      >
        <style>{`
          /* Remove outer border and radius */
          .ag-theme-balham .ag-root-wrapper { border: none !important; border-radius: 0 !important; box-shadow: none !important; }
          .ag-theme-balham .ag-root-wrapper-body { border-radius: 0 !important; }
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
          rowHeight={rowHeight}
          rowBuffer={100}
          suppressColumnVirtualisation
          suppressMovableColumns
          onGridReady={(p) => {
            gridApiRef.current = p.api;
          }}
        />
      </div>
    </Box>
  );
}
