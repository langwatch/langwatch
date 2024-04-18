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
import { DatabaseSchema, BatchProcessingS } from "@prisma/client";
import { useRouter } from "next/router";
import Parse from "papaparse";
import type { Key } from "react";
import { Play } from "react-feather";
import { useDrawer } from "~/components/CurrentDrawer";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { displayName } from "~/utils/datasets";

export default function Dataset() {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const batchId = router.query.id;
  const { openDrawer } = useDrawer();

  const evaluations = api.batchRecord.getAllByBatchID.useQuery(
    { projectId: project?.id ?? "", batchId: batchId as string },
    {
      enabled: !!project,
    }
  );

  console.log("ev", evaluations.data);

  const downloadCSV = () => {
    const fields = [
      "Dataset",
      "Evaluation",
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
    ];

    const csvData: CsvDataRow[] = [];

    evaluations.data?.forEach((evaluation) => {
      csvData.push([
        evaluation.datasetSlug,
        evaluation.evaluation,
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
    const fileName = `${evaluations.data[0]?.datasetSlug}.csv`;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <DashboardLayout>
      <Container maxW={"calc(100vw - 200px)"} padding={6} marginTop={8}>
        <HStack width="full" verticalAlign={"middle"} paddingBottom={6}>
          <Heading as={"h1"} size="lg">
            Dataset: {evaluations.data?.[0]?.datasetSlug ?? ""}
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
          {/* <Button
            colorScheme="blue"
            onClick={() => {
              openDrawer("batchEvaluation", {
                datasetSlug: dataset.data?.slug,
              });
            }}
            minWidth="fit-content"
            leftIcon={<Play height={16} />}
          >
            Batch Evaluation
          </Button> */}
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
                      ? evaluations.data?.map((evaluation, i) => (
                          <Tr key={i}>
                            <Td>{evaluation.evaluation}</Td>
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
                        ))
                      : null}
                  </Tbody>
                </Table>
              </TableContainer>
            )}
          </CardBody>
        </Card>
      </Container>
    </DashboardLayout>
  );
}
