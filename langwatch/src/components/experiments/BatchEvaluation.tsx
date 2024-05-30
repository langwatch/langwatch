import { DownloadIcon } from "@chakra-ui/icons";
import {
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
} from "@chakra-ui/react";
import type { Experiment, Project } from "@prisma/client";
import type { JsonObject } from "@prisma/client/runtime/library";
import Parse from "papaparse";
import { api } from "~/utils/api";

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
    const fileName = `${evaluations.data![0]?.datasetSlug}.csv`;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <Container maxW={"calc(100vw - 200px)"} padding={6} marginTop={8}>
      <HStack width="full" verticalAlign={"middle"} paddingBottom={6}>
        <Heading as={"h1"} size="lg">
          Dataset: {evaluations.data?.[0]?.dataset.name ?? ""}
        </Heading>

        <Spacer />
        <Button
          colorScheme="black"
          minWidth="fit-content"
          variant="ghost"
          onClick={() => evaluations.data && downloadCSV()}
        >
          Export <DownloadIcon marginLeft={2} />
        </Button>
      </HStack>
      <Card>
        <CardBody>
          {evaluations.data && evaluations.data.length == 0 ? (
            <Text>No data found</Text>
          ) : (
            <TableContainer>
              <Table variant="simple">
                <Thead>
                  <Tr>
                    <Th>Evaluation</Th>
                    <Th>Input</Th>
                    <Th>Output</Th>
                    <Th>Expected Output</Th>
                    <Th>Passed</Th>
                    <Th>Status</Th>
                    <Th>Details</Th>
                    <Th>Score</Th>
                    <Th>Cost</Th>
                    <Th>Created</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {evaluations.isLoading
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <Tr key={i}>
                          {Array.from({ length: 4 }).map((_, i) => (
                            <Td key={i}>
                              <Skeleton height="20px" />
                            </Td>
                          ))}
                        </Tr>
                      ))
                    : evaluations.data
                    ? evaluations.data?.map((evaluation, i) => {
                        const input = ((evaluation?.data as JsonObject)
                          ?.input ?? "") as string;
                        const output = ((evaluation?.data as JsonObject)
                          ?.output ?? "") as string;
                        const expected_output = ((
                          evaluation?.data as JsonObject
                        )?.expected_output ?? "") as string;

                        return (
                          <Tr key={i}>
                            <Td>{evaluation.evaluation}</Td>
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
                            <Td>{evaluation.passed ? "True" : "False"}</Td>
                            <Td>{evaluation.status}</Td>
                            <Td maxWidth={300}>
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
                            <Td>{evaluation.score}</Td>
                            <Td>${evaluation.cost}</Td>
                            <Td>
                              {new Date(evaluation.createdAt).toLocaleString()}
                            </Td>
                          </Tr>
                        );
                      })
                    : null}
                </Tbody>
              </Table>
            </TableContainer>
          )}
        </CardBody>
      </Card>
    </Container>
  );
}
