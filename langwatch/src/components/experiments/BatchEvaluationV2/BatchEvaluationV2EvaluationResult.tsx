import {
  Box,
  HStack,
  Image,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
  VStack,
} from "@chakra-ui/react";
import numeral from "numeral";
import { useEffect, useRef } from "react";
import { Info } from "react-feather";
import type { ESBatchEvaluation } from "../../../server/experiments/types";
import { formatMilliseconds } from "../../../utils/formatMilliseconds";
import { formatMoney } from "../../../utils/formatMoney";
import { HoverableBigText } from "../../HoverableBigText";
import { ExternalImage, isImageUrl } from "../../ExternalImage";

type RenderableRow = {
  render: () => JSX.Element;
  value: () => string;
};

type EvaluationResultsTableRow = {
  datasetColumns: RenderableRow[];
  predictedColumns: RenderableRow[];
  cost: RenderableRow;
  duration: RenderableRow;
  evaluationsColumns: Record<
    string,
    {
      evaluationInputs: RenderableRow[];
      evaluationResults: RenderableRow[];
    }
  >;
};

const evaluationResultsTableRow = (
  datasetEntry: ESBatchEvaluation["dataset"][number] | undefined,
  evaluationsForEntry: Record<
    string,
    ESBatchEvaluation["evaluations"][number] | undefined
  >,
  datasetColumns: Set<string>,
  predictedColumns: Set<string>,
  evaluationColumns: Record<
    string,
    {
      evaluationInputsColumns: Set<string>;
      evaluationResultsColumns: Set<string>;
    }
  >
): EvaluationResultsTableRow => {
  const evaluationsCost = Object.values(evaluationsForEntry).reduce(
    (acc, curr) => (acc ?? 0) + (curr?.cost ?? 0),
    0
  );
  const evaluationsDuration = Object.values(evaluationsForEntry).reduce(
    (acc, curr) => (acc ?? 0) + (curr?.duration ?? 0),
    0
  );

  const stringify = (value: any) =>
    typeof value === "object" ? JSON.stringify(value) : `${value}`;

  return {
    datasetColumns: Array.from(datasetColumns).map((column) => ({
      render: () => (
        <Td key={`dataset-${column}`} maxWidth="250px">
          {datasetEntry && isImageUrl(datasetEntry.entry[column]) ? (
            <ExternalImage
              src={datasetEntry.entry[column]}
              minWidth="24px"
              minHeight="24px"
              maxHeight="120px"
              maxWidth="100%"
            />
          ) : datasetEntry ? (
            <HoverableBigText>
              {stringify(datasetEntry.entry[column])}
            </HoverableBigText>
          ) : (
            "-"
          )}
        </Td>
      ),
      value: () => stringify(datasetEntry?.entry[column]),
    })),
    predictedColumns: Array.from(predictedColumns).map((column) => ({
      render: () => (
        <Td key={`predicted-${column}`} maxWidth="250px">
          {datasetEntry ? (
            <HoverableBigText>
              {stringify(datasetEntry.predicted?.[column])}
            </HoverableBigText>
          ) : (
            "-"
          )}
        </Td>
      ),
      value: () => stringify(datasetEntry?.predicted?.[column]),
    })),
    cost: {
      render: () => (
        <Td>
          <Tooltip
            label={
              <VStack align="start" gap={0}>
                <Text>Prediction cost: {datasetEntry?.cost ?? "-"}</Text>
                <Text>Evaluation cost: {evaluationsCost ?? "-"}</Text>
              </VStack>
            }
          >
            {!!datasetEntry?.cost || !!evaluationsCost
              ? formatMoney(
                  {
                    amount: (datasetEntry?.cost ?? 0) + (evaluationsCost ?? 0),
                    currency: "USD",
                  },
                  "$0.00[00]"
                )
              : "-"}
          </Tooltip>
        </Td>
      ),
      value: () => datasetEntry?.cost?.toString() ?? "",
    },
    duration: {
      render: () => (
        <Td>
          <Tooltip
            label={
              <VStack align="start" gap={0}>
                <Text>
                  Prediction duration:{" "}
                  {datasetEntry?.duration
                    ? formatMilliseconds(datasetEntry.duration)
                    : "-"}
                </Text>
                <Text>
                  Evaluation duration:{" "}
                  {evaluationsDuration
                    ? formatMilliseconds(evaluationsDuration)
                    : "-"}
                </Text>
              </VStack>
            }
          >
            {!!datasetEntry?.duration || !!evaluationsDuration
              ? formatMilliseconds(
                  (datasetEntry?.duration ?? 0) + (evaluationsDuration ?? 0)
                )
              : "-"}
          </Tooltip>
        </Td>
      ),
      value: () => datasetEntry?.duration?.toString() ?? "",
    },
    evaluationsColumns: Object.fromEntries(
      Object.entries(evaluationColumns).map(
        ([
          evaluator,
          { evaluationInputsColumns, evaluationResultsColumns },
        ]) => {
          const evaluation = evaluationsForEntry[evaluator];

          return [
            evaluator,
            {
              evaluationCost: {
                render: () => <Td>{evaluation?.cost}</Td>,
                value: () => evaluation?.cost?.toString() ?? "",
              },
              evaluationInputs: Array.from(evaluationInputsColumns).map(
                (column) => ({
                  render: () =>
                    datasetEntry?.error ? (
                      <Td
                        key={`evaluation-entry-${column}`}
                        background="red.200"
                      >
                        <Tooltip label={datasetEntry.error}>
                          <Box noOfLines={1}>Error</Box>
                        </Tooltip>
                      </Td>
                    ) : (
                      <Td key={`evaluation-entry-${column}`} maxWidth="250px">
                        {evaluation ? (
                          <HoverableBigText>
                            {stringify(evaluation.inputs?.[column] ?? "-")}
                          </HoverableBigText>
                        ) : (
                          "-"
                        )}
                      </Td>
                    ),
                  value: () => evaluation?.inputs?.[column] ?? "",
                })
              ),
              evaluationResults: Array.from(evaluationResultsColumns).map(
                (column) => ({
                  render: () => {
                    if (
                      column !== "details" &&
                      evaluation?.status === "error"
                    ) {
                      return (
                        <Td
                          key={`evaluation-result-${column}`}
                          background="red.200"
                        >
                          <Tooltip label={evaluation.details}>
                            <Box noOfLines={1}>Error</Box>
                          </Tooltip>
                        </Td>
                      );
                    }

                    if (
                      column !== "details" &&
                      evaluation?.status === "skipped"
                    ) {
                      return (
                        <Td
                          key={`evaluation-result-${column}`}
                          background="yellow.100"
                        >
                          <Tooltip label={evaluation.details}>
                            <Box noOfLines={1}>Skipped</Box>
                          </Tooltip>
                        </Td>
                      );
                    }

                    const value = (
                      evaluation as Record<string, any> | undefined
                    )?.[column];
                    return (
                      <Td
                        key={`evaluation-result-${column}`}
                        background={
                          value === false
                            ? "red.100"
                            : value === true
                            ? "green.100"
                            : "none"
                        }
                      >
                        {column === "details" ? (
                          <HoverableBigText
                            noOfLines={3}
                            maxWidth="300px"
                            whiteSpace="pre-wrap"
                          >
                            {value}
                          </HoverableBigText>
                        ) : value === false ? (
                          "false"
                        ) : value === true ? (
                          "true"
                        ) : !isNaN(Number(value)) ? (
                          numeral(Number(value)).format("0.[00]")
                        ) : (
                          value ?? "-"
                        )}
                      </Td>
                    );
                  },
                  value: () => {
                    if (
                      column !== "details" &&
                      evaluation?.status === "error"
                    ) {
                      return "Error";
                    }

                    if (
                      column !== "details" &&
                      evaluation?.status === "skipped"
                    ) {
                      return "Skipped";
                    }

                    const value = (
                      evaluation as Record<string, any> | undefined
                    )?.[column];

                    return column === "details"
                      ? value
                      : value === false
                      ? "false"
                      : value === true
                      ? "true"
                      : !isNaN(Number(value))
                      ? numeral(Number(value)).format("0.[00]")
                      : value ?? "";
                  },
                })
              ),
            },
          ];
        }
      )
    ),
  };
};

export const evaluationResultsTableData = (
  resultsByEvaluator: Record<string, ESBatchEvaluation["evaluations"]>,
  datasetByIndex: Record<number, ESBatchEvaluation["dataset"][number]>,
  datasetColumns: Set<string>,
  predictedColumns: Set<string>
) => {
  const evaluationColumns = Object.fromEntries(
    Object.entries(resultsByEvaluator).map(([evaluator, results]) => [
      evaluator,
      getEvaluationColumns(results),
    ])
  );

  const totalRows = Math.max(
    ...Object.values(datasetByIndex).map((d) => d.index + 1)
  );

  return {
    headers: {
      datasetColumns,
      predictedColumns,
      cost: "Cost",
      duration: "Duration",
      evaluationColumns,
    },
    rows: Array.from({ length: totalRows }).map((_, index) => {
      const datasetEntry = datasetByIndex[index];
      const evaluationsForEntry = Object.fromEntries(
        Object.entries(resultsByEvaluator).map(([evaluator, results]) => [
          evaluator,
          results.find((r) => r.index === index),
        ])
      );

      return evaluationResultsTableRow(
        datasetEntry,
        evaluationsForEntry,
        datasetColumns,
        predictedColumns,
        evaluationColumns
      );
    }),
  };
};

const getEvaluationColumns = (
  results: ESBatchEvaluation["evaluations"]
): {
  evaluationInputsColumns: Set<string>;
  evaluationResultsColumns: Set<string>;
} => {
  const evaluationInputsColumns = new Set(
    results.flatMap((result) => Object.keys(result.inputs ?? {}))
  );
  const evaluatorResultsColumnsMap = {
    passed: false,
    score: false,
    label: false,
    details: false,
  };
  for (const result of results) {
    if (result.score !== undefined && result.score !== null) {
      evaluatorResultsColumnsMap.score = true;
    }
    if (result.passed !== undefined && result.passed !== null) {
      evaluatorResultsColumnsMap.passed = true;
    }
    if (result.label !== undefined && result.label !== null) {
      evaluatorResultsColumnsMap.label = true;
    }
    if (result.details !== undefined && result.details !== null) {
      evaluatorResultsColumnsMap.details = true;
    }
  }
  if (
    !evaluatorResultsColumnsMap.passed &&
    !evaluatorResultsColumnsMap.score &&
    !evaluatorResultsColumnsMap.label
  ) {
    evaluatorResultsColumnsMap.score = true;
  }
  const evaluationResultsColumns = new Set(
    Object.entries(evaluatorResultsColumnsMap)
      .filter(([_key, value]) => value)
      .map(([key]) => key)
  );

  return {
    evaluationInputsColumns,
    evaluationResultsColumns,
  };
};

export function BatchEvaluationV2EvaluationResult({
  evaluator,
  results,
  datasetByIndex,
  datasetColumns,
  predictedColumns,
  isFinished,
  size = "md",
  hasScrolled,
  workflowId,
}: {
  evaluator: string;
  results: ESBatchEvaluation["evaluations"];
  datasetByIndex: Record<number, ESBatchEvaluation["dataset"][number]>;
  datasetColumns: Set<string>;
  predictedColumns: Set<string>;
  isFinished: boolean;
  size?: "sm" | "md";
  hasScrolled: boolean;
  workflowId: string | null;
}) {
  const tableData = evaluationResultsTableData(
    { [evaluator]: results },
    datasetByIndex,
    datasetColumns,
    predictedColumns
  );
  const evaluatorHeaders = tableData.headers.evaluationColumns[evaluator]!;

  // Scroll to the bottom on rerender if component was at the bottom previously
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = containerRef.current;

    return () => {
      let isAtBottom = true;
      const scrollParent = container?.parentElement?.parentElement;
      if (scrollParent) {
        const currentScrollTop = scrollParent.scrollTop;
        const scrollParentHeight = scrollParent.clientHeight;

        isAtBottom =
          currentScrollTop + scrollParentHeight + 32 >=
          scrollParent.scrollHeight;
      }

      if (isAtBottom || (!hasScrolled && !isFinished)) {
        setTimeout(() => {
          if (!containerRef.current || hasScrolled) return;
          scrollParent?.scrollTo({
            // eslint-disable-next-line react-hooks/exhaustive-deps
            top: containerRef.current.scrollHeight,
            behavior: "smooth",
          });
        }, 100);
        setTimeout(() => {
          if (!containerRef.current || hasScrolled) return;
          scrollParent?.scrollTo({
            // eslint-disable-next-line react-hooks/exhaustive-deps
            top: containerRef.current.scrollHeight,
            behavior: "smooth",
          });
        }, 1000);
      }
    };
  }, [results, isFinished, hasScrolled]);

  return (
    <TableContainer ref={containerRef}>
      <Table size={size === "sm" ? "xs" : "sm"} variant="grid">
        <Thead>
          <Tr>
            <Th width="35px" rowSpan={2}></Th>

            <Th colSpan={datasetColumns.size} paddingY={2}>
              <Text>Dataset</Text>
            </Th>

            {predictedColumns.size > 0 && (
              <Th colSpan={predictedColumns.size} paddingY={2}>
                <HStack>
                  <Text>Predicted</Text>
                  {workflowId && (
                    <Tooltip label="Values plugged in the End node will show up here">
                      <Info size={14} />
                    </Tooltip>
                  )}
                </HStack>
              </Th>
            )}

            {results.length > 0 &&
              evaluatorHeaders.evaluationInputsColumns.size > 0 && (
                <Th
                  colSpan={evaluatorHeaders.evaluationInputsColumns.size}
                  paddingY={2}
                >
                  <Text>Evaluation Entry</Text>
                </Th>
              )}

            <Th rowSpan={2}>Cost</Th>
            <Th rowSpan={2}>Duration</Th>

            {Array.from(evaluatorHeaders.evaluationResultsColumns).map(
              (column) => (
                <Th key={`evaluation-result-${column}`} rowSpan={2}>
                  {column}
                </Th>
              )
            )}
          </Tr>
          <Tr>
            {Array.from(tableData.headers.datasetColumns).map((column) => (
              <Th key={`dataset-${column}`} paddingY={2}>
                {column}
              </Th>
            ))}
            {Array.from(tableData.headers.predictedColumns).map((column) => (
              <Th key={`predicted-${column}`} paddingY={2}>
                {column}
              </Th>
            ))}
            {Array.from(evaluatorHeaders.evaluationInputsColumns).map(
              (column) => (
                <Th key={`evaluation-entry-${column}`} paddingY={2}>
                  {column}
                </Th>
              )
            )}
          </Tr>
        </Thead>
        <Tbody>
          {tableData.rows.map((row, index) => (
            <Tr key={index}>
              <Td width="35px">{index + 1}</Td>

              {Array.from(row.datasetColumns).map((column) => column.render())}

              {Array.from(row.predictedColumns).map((column) =>
                column.render()
              )}

              {Array.from(
                row.evaluationsColumns[evaluator]?.evaluationInputs ?? []
              ).map((input) => input.render())}

              {row.cost.render()}
              {row.duration.render()}
              {Array.from(
                row.evaluationsColumns[evaluator]?.evaluationResults ?? []
              ).map((result) => result.render())}
            </Tr>
          ))}
        </Tbody>
      </Table>
    </TableContainer>
  );
}
