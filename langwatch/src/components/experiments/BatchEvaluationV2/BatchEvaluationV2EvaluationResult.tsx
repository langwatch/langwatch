import { Box, HStack, Table, VStack } from "@chakra-ui/react";
import { Tooltip } from "../../../components/ui/tooltip";
import numeral from "numeral";
import { useEffect, useRef } from "react";
import { Info } from "react-feather";
import type { ESBatchEvaluation } from "../../../server/experiments/types";
import { formatMilliseconds } from "../../../utils/formatMilliseconds";
import { formatMoney } from "../../../utils/formatMoney";
import { HoverableBigText } from "../../HoverableBigText";
import { ExternalImage, isImageUrl } from "../../ExternalImage";

type RenderableRow = {
  render: () => React.ReactNode;
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
  predictedColumns: Record<string, Set<string>>,
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
        <Table.Cell key={`dataset-${column}`} maxWidth="250px">
          {datasetEntry && isImageUrl(datasetEntry.entry[column]) ? (
            <ExternalImage
              src={datasetEntry.entry[column]}
              minWidth="24px"
              minHeight="24px"
              maxHeight="120px"
              maxWidth="100%"
            />
          ) : datasetEntry?.entry?.[column] ? (
            <HoverableBigText>
              {stringify(datasetEntry.entry[column])}
            </HoverableBigText>
          ) : (
            "-"
          )}
        </Table.Cell>
      ),
      value: () => stringify(datasetEntry?.entry[column]),
    })),
    predictedColumns: Object.entries(predictedColumns).flatMap(
      ([node, columns]) =>
        Array.from(columns).map((column) => ({
          render: () => {
            if (datasetEntry?.error) {
              return (
                <Table.Cell key={`predicted-${column}`} background="red.200">
                  <Tooltip
                    content={datasetEntry.error}
                    positioning={{ placement: "top" }}
                  >
                    <Box lineClamp={1}>Error</Box>
                  </Tooltip>
                </Table.Cell>
              );
            }

            return (
              <Table.Cell key={`predicted-${node}-${column}`} maxWidth="250px">
                {datasetEntry?.predicted?.[node]?.[column] ? (
                  <HoverableBigText>
                    {stringify(datasetEntry.predicted?.[node]?.[column])}
                  </HoverableBigText>
                ) : (
                  "-"
                )}
              </Table.Cell>
            );
          },
          value: () => stringify(datasetEntry?.predicted?.[node]?.[column]),
        }))
    ),
    cost: {
      render: () => (
        <Table.Cell whiteSpace="nowrap">
          <Tooltip
            content={
              <VStack align="start" gap={0}>
                <Box>Prediction cost: {datasetEntry?.cost ?? "-"}</Box>
                <Box>Evaluation cost: {evaluationsCost ?? "-"}</Box>
              </VStack>
            }
            positioning={{ placement: "top" }}
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
        </Table.Cell>
      ),
      value: () => datasetEntry?.cost?.toString() ?? "",
    },
    duration: {
      render: () => (
        <Table.Cell>
          <Tooltip
            content={
              <VStack align="start" gap={0}>
                <Box>
                  Prediction duration:{" "}
                  {datasetEntry?.duration
                    ? formatMilliseconds(datasetEntry.duration)
                    : "-"}
                </Box>
                <Box>
                  Evaluation duration:{" "}
                  {evaluationsDuration
                    ? formatMilliseconds(evaluationsDuration)
                    : "-"}
                </Box>
              </VStack>
            }
            positioning={{ placement: "top" }}
          >
            {!!datasetEntry?.duration || !!evaluationsDuration
              ? formatMilliseconds(
                  (datasetEntry?.duration ?? 0) + (evaluationsDuration ?? 0)
                )
              : "-"}
          </Tooltip>
        </Table.Cell>
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
                render: () => <Table.Cell>{evaluation?.cost}</Table.Cell>,
                value: () => evaluation?.cost?.toString() ?? "",
              },
              evaluationInputs: Array.from(evaluationInputsColumns).map(
                (column) => ({
                  render: () =>
                    datasetEntry?.error ? (
                      <Table.Cell
                        key={`evaluation-entry-${column}`}
                        background="red.200"
                      >
                        <Tooltip
                          content={datasetEntry.error}
                          positioning={{ placement: "top" }}
                        >
                          <Box lineClamp={1}>Error</Box>
                        </Tooltip>
                      </Table.Cell>
                    ) : (
                      <Table.Cell
                        key={`evaluation-entry-${column}`}
                        maxWidth="250px"
                      >
                        {evaluation ? (
                          <HoverableBigText>
                            {stringify(evaluation.inputs?.[column] ?? "-")}
                          </HoverableBigText>
                        ) : (
                          "-"
                        )}
                      </Table.Cell>
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
                        <Table.Cell
                          key={`evaluation-result-${column}`}
                          background="red.200"
                        >
                          <Tooltip
                            content={evaluation.details}
                            positioning={{ placement: "top" }}
                          >
                            <Box lineClamp={1}>Error</Box>
                          </Tooltip>
                        </Table.Cell>
                      );
                    }

                    if (
                      column !== "details" &&
                      evaluation?.status === "skipped"
                    ) {
                      return (
                        <Table.Cell
                          key={`evaluation-result-${column}`}
                          background="yellow.100"
                        >
                          <Tooltip
                            content={evaluation.details}
                            positioning={{ placement: "top" }}
                          >
                            <Box lineClamp={1}>Skipped</Box>
                          </Tooltip>
                        </Table.Cell>
                      );
                    }

                    const value = (
                      evaluation as Record<string, any> | undefined
                    )?.[column];
                    return (
                      <Table.Cell
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
                            lineClamp={3}
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
                      </Table.Cell>
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
  predictedColumns: Record<string, Set<string>>
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
  predictedColumns: Record<string, Set<string>>;
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
    <Box ref={containerRef}>
      {/* @ts-ignore */}
      <Table.Root size={size === "sm" ? "xs" : "sm"} variant="grid">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader
              width="35px"
              rowSpan={2}
              borderTop="none"
            ></Table.ColumnHeader>

            {datasetColumns.size > 0 && (
              <Table.ColumnHeader
                colSpan={datasetColumns.size}
                paddingY={2}
                borderTop="none"
              >
                <Box>Dataset</Box>
              </Table.ColumnHeader>
            )}

            {Object.keys(predictedColumns ?? {}).map((node) => (
              <Table.ColumnHeader
                colSpan={predictedColumns[node]?.size ?? 0}
                paddingY={2}
                borderTop="none"
              >
                <HStack>
                  <Box>{node}</Box>
                </HStack>
              </Table.ColumnHeader>
            ))}

            {results.length > 0 &&
              evaluatorHeaders.evaluationInputsColumns.size > 0 && (
                <Table.ColumnHeader
                  colSpan={evaluatorHeaders.evaluationInputsColumns.size}
                  paddingY={2}
                  borderTop="none"
                >
                  <Box>Evaluation Entry</Box>
                </Table.ColumnHeader>
              )}

            <Table.ColumnHeader rowSpan={2} borderTop="none">
              Cost
            </Table.ColumnHeader>
            <Table.ColumnHeader rowSpan={2} borderTop="none">
              Duration
            </Table.ColumnHeader>

            {Array.from(evaluatorHeaders.evaluationResultsColumns).map(
              (column) => (
                <Table.ColumnHeader
                  key={`evaluation-result-${column}`}
                  rowSpan={2}
                  borderTop="none"
                >
                  {column}
                </Table.ColumnHeader>
              )
            )}
          </Table.Row>
          <Table.Row>
            {Array.from(tableData.headers.datasetColumns).map((column) => (
              <Table.ColumnHeader key={`dataset-${column}`} paddingY={2}>
                {column}
              </Table.ColumnHeader>
            ))}
            {Object.entries(predictedColumns ?? {}).map(([node, columns]) =>
              Array.from(columns).map((column) => (
                <Table.ColumnHeader
                  key={`predicted-${node}-${column}`}
                  paddingY={2}
                >
                  {column}
                </Table.ColumnHeader>
              ))
            )}
            {Array.from(evaluatorHeaders.evaluationInputsColumns).map(
              (column) => (
                <Table.ColumnHeader
                  key={`evaluation-entry-${column}`}
                  paddingY={2}
                >
                  {column}
                </Table.ColumnHeader>
              )
            )}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {tableData.rows.map((row, index) => (
            <Table.Row key={index}>
              <Table.Cell width="35px">{index + 1}</Table.Cell>

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
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}
