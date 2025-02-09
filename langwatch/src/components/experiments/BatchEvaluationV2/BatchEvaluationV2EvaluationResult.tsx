import {
  Box,
  Table,
  TableContainer,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tooltip,
  Tr,
  VStack
} from "@chakra-ui/react";
import numeral from "numeral";
import { useEffect, useRef } from "react";
import type { ESBatchEvaluation } from "../../../server/experiments/types";
import { formatMilliseconds } from "../../../utils/formatMilliseconds";
import { formatMoney } from "../../../utils/formatMoney";
import { HoverableBigText } from "../../HoverableBigText";

export function BatchEvaluationV2EvaluationResult({
  results,
  datasetByIndex,
  datasetColumns,
  isFinished,
  size = "md",
  hasScrolled,
}: {
  results: ESBatchEvaluation["evaluations"];
  datasetByIndex: Record<number, ESBatchEvaluation["dataset"][number]>;
  datasetColumns: Set<string>;
  isFinished: boolean;
  size?: "sm" | "md";
  hasScrolled: boolean;
}) {
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

  const totalRows = Math.max(
    ...Object.values(datasetByIndex).map((d) => d.index + 1)
  );

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

            {results.length > 0 && (
              <Th colSpan={evaluationInputsColumns.size} paddingY={2}>
                <Text>Evaluation Entry</Text>
              </Th>
            )}

            <Th rowSpan={2}>Cost</Th>
            <Th rowSpan={2}>Duration</Th>

            {Array.from(evaluationResultsColumns).map((column) => (
              <Th key={`evaluation-result-${column}`} rowSpan={2}>
                {column}
              </Th>
            ))}
          </Tr>
          <Tr>
            {Array.from(datasetColumns).map((column) => (
              <Th key={`dataset-${column}`} paddingY={2}>
                {column}
              </Th>
            ))}
            {Array.from(evaluationInputsColumns).map((column) => (
              <Th key={`evaluation-entry-${column}`} paddingY={2}>
                {column}
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {Array.from({ length: totalRows }).map((_, index) => {
            const evaluation = results.find((r) => r.index === index);
            const datasetEntry = datasetByIndex[index];

            return (
              <Tr key={index}>
                <Td width="35px">{index + 1}</Td>

                {Array.from(datasetColumns).map((column) => (
                  <Td key={`dataset-${column}`} maxWidth="250px">
                    {datasetEntry ? (
                      <HoverableBigText>
                        {datasetEntry.entry[column] ?? "-"}
                      </HoverableBigText>
                    ) : (
                      "-"
                    )}
                  </Td>
                ))}

                {datasetEntry?.error
                  ? Array.from(evaluationInputsColumns).map((column) => (
                      <Td
                        key={`evaluation-entry-${column}`}
                        background="red.200"
                      >
                        <Tooltip label={datasetEntry.error}>
                          <Box noOfLines={1}>Error</Box>
                        </Tooltip>
                      </Td>
                    ))
                  : Array.from(evaluationInputsColumns).map((column) => (
                      <Td key={`evaluation-entry-${column}`} maxWidth="250px">
                        {evaluation ? (
                          <HoverableBigText>
                            {evaluation.inputs[column] ?? "-"}
                          </HoverableBigText>
                        ) : (
                          "-"
                        )}
                      </Td>
                    ))}

                <Td>
                  <Tooltip
                    label={
                      <VStack align="start" spacing={0}>
                        <Text>
                          Prediction cost: {datasetEntry?.cost ?? "-"}
                        </Text>
                        <Text>Evaluation cost: {evaluation?.cost ?? "-"}</Text>
                      </VStack>
                    }
                  >
                    {!!datasetEntry?.cost || !!evaluation?.cost
                      ? formatMoney(
                          {
                            amount:
                              (datasetEntry?.cost ?? 0) +
                              (evaluation?.cost ?? 0),
                            currency: "USD",
                          },
                          "$0.00[00]"
                        )
                      : "-"}
                  </Tooltip>
                </Td>
                <Td>
                  {datasetEntry?.duration
                    ? formatMilliseconds(datasetEntry.duration)
                    : "-"}
                </Td>

                {Array.from(evaluationResultsColumns).map((column) => {
                  if (column !== "details" && evaluation?.status === "error") {
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
                })}
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    </TableContainer>
  );
}
