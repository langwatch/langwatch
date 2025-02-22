import { DownloadIcon } from "@chakra-ui/icons";
import {
  Box,
  Button,
  Card,
  CardBody,
  Container,
  HStack,
  Heading,
  Skeleton,
  Spacer,
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
import type { BatchEvaluation, Experiment, Project } from "@prisma/client";
import type { JsonObject } from "@prisma/client/runtime/library";
import numeral from "numeral";
import Parse from "papaparse";
import { api } from "~/utils/api";
import { formatMoney } from "../../utils/formatMoney";

export default function BatchEvaluation({
  project,
  experiment,
}: {
  project: Project;
  experiment: Experiment;
}) {
  const evaluations = api.batchRecord.getAllByexperimentSlug.useQuery({
    projectId: project.id ?? "",
    experimentSlug: experiment.slug ?? "",
  });

  const downloadCSV = () => {
    const fields = [
      "Dataset",
      "Evaluation",
      "Input",
      "Output",
      "Expected Output",
      "Passed",
      "Status",
      "Details",
      "Score",
      "Label",
      "Cost",
      "Created at",
    ];

    type CsvDataRow = [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      number,
      string,
      number,
      string,
    ];

    const csvData: CsvDataRow[] = [];

    evaluations.data?.forEach((evaluation) => {
      const input = (evaluation?.data as JsonObject)?.input;
      const output = (evaluation?.data as JsonObject)?.output;
      const expected_output = (evaluation?.data as JsonObject)?.expected_output;

      csvData.push([
        evaluation.datasetSlug,
        evaluation.evaluation,
        input as string,
        output as string,
        expected_output as string,
        evaluation.passed ? "True" : "False",
        evaluation.status,
        evaluation.details,
        evaluation.score,
        evaluation.label ?? "",
        evaluation.cost,
        new Date(evaluation.createdAt).toLocaleString(),
      ]);
    });

    const csv = Parse.unparse({
      fields: fields,
      data: csvData,
    });

    const url = window.URL.createObjectURL(new Blob([csv]));

    const link = document.createElement("a");
    link.href = url;
    const fileName = `${experiment?.slug}.csv`;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  const totalCost = evaluations.data?.reduce((acc, curr) => acc + curr.cost, 0);
  const earliestEvaluation = evaluations.data?.reduce(
    (acc: BatchEvaluation | undefined, curr) => {
      return !acc || new Date(curr.createdAt) < new Date(acc.createdAt)
        ? curr
        : acc;
    },
    undefined
  );
  const latestEvaluation = evaluations.data?.reduce(
    (acc: BatchEvaluation | undefined, curr) => {
      return !acc || new Date(curr.createdAt) > new Date(acc.createdAt)
        ? curr
        : acc;
    },
    undefined
  );
  const runtime =
    latestEvaluation && earliestEvaluation
      ? new Date(latestEvaluation.createdAt).getTime() -
        new Date(earliestEvaluation.createdAt).getTime()
      : 0;

  const groupedByEvaluation = evaluations.data?.reduce(
    (acc, curr) => {
      if (!acc[curr.evaluation]) {
        acc[curr.evaluation] = {
          all: [],
          processed: [],
          error: [],
          skipped: [],
          unknown: [],
        };
      }
      acc[curr.evaluation]!.all.push(curr);
      acc[curr.evaluation]![
        curr.status === "processed"
          ? "processed"
          : curr.status === "error"
          ? "error"
          : curr.status === "skipped"
          ? "skipped"
          : "unknown"
      ].push(curr);
      return acc;
    },
    {} as Record<
      string,
      {
        all: BatchEvaluation[];
        processed: BatchEvaluation[];
        error: BatchEvaluation[];
        skipped: BatchEvaluation[];
        unknown: BatchEvaluation[];
      }
    >
  );

  const passedOrScoreMetric: Record<string, "passed" | "score"> =
    Object.fromEntries(
      Object.entries(groupedByEvaluation ?? {}).map(
        ([evaluation, evaluations]) => {
          return [
            evaluation,
            evaluations.processed.some((evaluation) => evaluation.score)
              ? "score"
              : "passed",
          ];
        }
      )
    );

  const averageScoresPerEvaluation = Object.fromEntries(
    Object.entries(groupedByEvaluation ?? {}).map(
      ([evaluation, evaluations]) => {
        if (passedOrScoreMetric[evaluation] === "score") {
          return [
            evaluation,
            evaluations.processed.reduce((acc, curr) => acc + curr.score, 0) /
              evaluations.processed.length,
          ];
        } else {
          return [
            evaluation,
            evaluations.processed.filter((evaluation) => evaluation.passed)
              .length / evaluations.processed.length,
          ];
        }
      }
    )
  );

  return (
    <Box background="white" width="full" height="full" paddingTop={14}>
      <Container maxW={"calc(100vw - 200px)"}>
        <HStack width="full" verticalAlign={"middle"} paddingBottom={6}>
          <VStack align="start">
            <Heading as={"h1"} size="lg">
              {experiment.name ?? experiment.slug}
            </Heading>
            <Text>Dataset: {evaluations.data?.[0]?.dataset.name ?? ""}</Text>
          </VStack>

          <Spacer />
          <Button
            colorPalette="black"
            minWidth="fit-content"
            variant="ghost"
            onClick={() => evaluations.data && downloadCSV()}
          >
            Download Results CSV <DownloadIcon marginLeft={2} />
          </Button>
        </HStack>
      </Container>
      <HStack
        align="center"
        alignItems="stretch"
        justify="center"
        background="gray.50"
        padding={6}
        gap={6}
      >
        {Object.entries(averageScoresPerEvaluation).map(
          ([evaluation, score]) => (
            <Card key={evaluation}>
              <CardBody>
                <VStack
                  align="start"
                  justify="center"
                  height="full"
                  gap={2}
                >
                  <Text color="gray.700" fontSize="15px" fontWeight="500">
                    {evaluation}
                  </Text>
                  <HStack
                    align="end"
                    color={score < 0.5 ? "red.500" : "green.500"}
                  >
                    <Text fontSize="26px" fontWeight="300">
                      {typeof score === "number"
                        ? numeral(score).format(
                            passedOrScoreMetric[evaluation] === "score"
                              ? "0.00"
                              : "0%"
                          )
                        : score}
                    </Text>
                    <Text
                      fontSize="13px"
                      fontWeight="500"
                      marginBottom="4px"
                      opacity={0.8}
                    >
                      {passedOrScoreMetric[evaluation] === "score"
                        ? "avg score"
                        : "pass rate"}
                    </Text>
                  </HStack>
                  <HStack
                    fontSize="11px"
                    textTransform="uppercase"
                    fontWeight="600"
                    color="gray.500"
                  >
                    {groupedByEvaluation?.[evaluation]?.skipped.length && (
                      <Text>
                        <Box
                          display="inline-block"
                          background="yellow.400"
                          borderRadius="100%"
                          width={2}
                          height={2}
                          marginRight={1}
                        ></Box>
                        {groupedByEvaluation?.[evaluation]?.skipped.length}{" "}
                        skipped
                      </Text>
                    )}
                    {groupedByEvaluation?.[evaluation]?.error.length && (
                      <Text>
                        <Box
                          display="inline-block"
                          background="red.400"
                          borderRadius="100%"
                          width={2}
                          height={2}
                          marginRight={1}
                        ></Box>
                        {groupedByEvaluation?.[evaluation]?.error.length} error
                      </Text>
                    )}
                  </HStack>
                </VStack>
              </CardBody>
            </Card>
          )
        )}
        <Card>
          <CardBody>
            <VStack align="start" justify="center" height="full" gap={2}>
              <Text color="gray.700" fontSize="15px" fontWeight="500">
                Evaluations Cost
              </Text>
              <Text fontSize="26px" fontWeight="300">
                {totalCost
                  ? formatMoney({ amount: totalCost, currency: "USD" })
                  : "-"}
              </Text>
            </VStack>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <VStack align="start" justify="center" height="full" gap={2}>
              <Text color="gray.700" fontSize="15px" fontWeight="500">
                Runtime
              </Text>
              <Text fontSize="26px" fontWeight="300">
                {runtime ? numeral(runtime / 1000).format("00:00:00") : "-"}
              </Text>
            </VStack>
          </CardBody>
        </Card>
      </HStack>
      <Box
        width="full"
        paddingBottom={12}
        display="flex"
        justifyContent="center"
        overflowX="scroll"
        paddingX={6}
      >
        <VStack align="start" minWidth="0">
          {evaluations.isLoading ? (
            <TableContainer>
              <Table variant="simple">
                <Tbody>
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Tr key={i}>
                      {Array.from({ length: 4 }).map((_, i) => (
                        <Td key={i}>
                          <Skeleton height="20px" />
                        </Td>
                      ))}
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </TableContainer>
          ) : evaluations.data && evaluations.data.length == 0 ? (
            <Text>No data found</Text>
          ) : (
            Object.entries(groupedByEvaluation ?? {}).map(
              ([evaluationKey, evaluations]) => {
                const hasExpectedOutput = evaluations.all.some(
                  (evaluation) =>
                    (evaluation.data as JsonObject)?.expected_output
                );
                const hasDetails = evaluations.all.some(
                  (evaluation) => evaluation.details
                );

                return (
                  <VStack
                    key={evaluationKey}
                    align="start"
                    gap={8}
                    paddingTop={12}
                  >
                    <Heading as={"h2"} size="md">
                      {evaluationKey}
                    </Heading>
                    <TableContainer>
                      <Table
                        variant="simple"
                        border="1px solid"
                        borderColor="gray.200"
                      >
                        <Thead>
                          <Tr>
                            <Th>Input</Th>
                            <Th>Output</Th>
                            {hasExpectedOutput && <Th>Expected Output</Th>}
                            <Th>Status</Th>
                            <Th minWidth={120} textAlign="center">
                              {passedOrScoreMetric[evaluationKey] === "score"
                                ? "Score"
                                : "Passed"}
                            </Th>
                            {hasDetails && <Th>Details</Th>}
                            <Th>Cost</Th>
                            <Th>Created</Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {evaluations.all.map((evaluation, i) => {
                            const input = ((evaluation?.data as JsonObject)
                              ?.input ?? "") as string;
                            const output = ((evaluation?.data as JsonObject)
                              ?.output ?? "") as string;
                            const expected_output = ((
                              evaluation?.data as JsonObject
                            )?.expected_output ?? "") as string;

                            return (
                              <Tr key={i}>
                                <Td>
                                  <Tooltip label={input}>
                                    <Text
                                      noOfLines={2}
                                      display="block"
                                      maxWidth={230}
                                    >
                                      {input}
                                    </Text>
                                  </Tooltip>
                                </Td>
                                <Td>
                                  <Tooltip label={output}>
                                    <Text
                                      noOfLines={2}
                                      display="block"
                                      maxWidth={230}
                                    >
                                      {output}
                                    </Text>
                                  </Tooltip>
                                </Td>
                                {hasExpectedOutput && (
                                  <Td>
                                    <Tooltip label={expected_output}>
                                      <Text
                                        noOfLines={2}
                                        display="block"
                                        maxWidth={230}
                                      >
                                        {expected_output}
                                      </Text>
                                    </Tooltip>
                                  </Td>
                                )}
                                <Td
                                  color={
                                    evaluation.status === "skipped"
                                      ? "yellow.700"
                                      : evaluation.status === "error"
                                      ? "red.700"
                                      : undefined
                                  }
                                >
                                  {evaluation.status}
                                </Td>
                                {evaluation.status === "processed" ? (
                                  <Td
                                    textAlign="center"
                                    fontWeight="500"
                                    color={
                                      passedOrScoreMetric[evaluationKey] ===
                                      "score"
                                        ? evaluation.score < 0.5
                                          ? "red.500"
                                          : "green.500"
                                        : evaluation.passed
                                        ? "green.500"
                                        : "red.500"
                                    }
                                  >
                                    {passedOrScoreMetric[evaluationKey] ===
                                    "score"
                                      ? numeral(evaluation.score).format("0.00")
                                      : evaluation.passed
                                      ? "True"
                                      : "False"}
                                  </Td>
                                ) : (
                                  <Td textAlign="center">-</Td>
                                )}
                                {hasDetails && (
                                  <Td
                                    maxWidth={300}
                                    color={
                                      evaluation.status === "skipped"
                                        ? "yellow.700"
                                        : evaluation.status === "error"
                                        ? "red.700"
                                        : undefined
                                    }
                                  >
                                    <Tooltip label={evaluation.details}>
                                      <Text
                                        noOfLines={1}
                                        wordBreak="break-all"
                                        display="block"
                                      >
                                        {evaluation.details}
                                      </Text>
                                    </Tooltip>
                                  </Td>
                                )}
                                <Td>
                                  {evaluation.cost
                                    ? formatMoney({
                                        amount: evaluation.cost,
                                        currency: "USD",
                                      })
                                    : "-"}
                                </Td>
                                <Td>
                                  {new Date(
                                    evaluation.createdAt
                                  ).toLocaleString()}
                                </Td>
                              </Tr>
                            );
                          })}
                        </Tbody>
                      </Table>
                    </TableContainer>
                  </VStack>
                );
              }
            )
          )}
        </VStack>
      </Box>
    </Box>
  );
}
