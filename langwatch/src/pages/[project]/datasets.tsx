import {
  Button,
  Card,
  CardBody,
  Container,
  HStack,
  Heading,
  MenuButton,
  MenuItem,
  MenuList,
  Skeleton,
  Spacer,
  Tab,
  TabList,
  TabPanel,
  TabPanels,
  Table,
  TableContainer,
  Tabs,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  useDisclosure,
  useToast,
  Menu,
  Tag,
} from "@chakra-ui/react";

import { useRouter } from "next/router";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { AddDatasetDrawer } from "~/components/AddDatasetDrawer";
import { schemaDisplayName } from "~/utils/datasets";
import { Play, MoreVertical } from "react-feather";
import { useDrawer } from "~/components/CurrentDrawer";
import { DeleteIcon } from "@chakra-ui/icons";

export default function Datasets() {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const toast = useToast();

  const datasets = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project,
    }
  );

  const batchEvaluationRecords = api.batchRecord.getAllByBatchIDGroup.useQuery(
    { projectId: project?.id ?? "" },
    {
      enabled: !!project,
    }
  );

  const goToBatchEvaluation = (id: string) => {
    void router.push({
      pathname: `/${project?.slug}/batch-evaluations/${id}`,
    });
  };

  const onSuccess = () => {
    void datasets.refetch();
    onClose();
  };

  const datasetDelete = api.dataset.deleteById.useMutation();

  // TODO: make this a soft delete only
  const deleteDataset = (id: string) => {
    datasetDelete.mutate(
      { projectId: project?.id ?? "", datasetId: id },
      {
        onSuccess: () => {
          void datasets.refetch();
          toast({
            title: "Dataset deleted",
            description: (
              <HStack>
                <Button
                  colorScheme="white"
                  variant="link"
                  textDecoration="underline"
                  onClick={() => {
                    toast.closeAll();
                    datasetDelete.mutate(
                      {
                        projectId: project?.id ?? "",
                        datasetId: id,
                        undo: true,
                      },
                      {
                        onSuccess: () => {
                          void datasets.refetch();
                          toast({
                            title: "Dataset restored",
                            description: "The dataset has been restored.",
                            status: "success",
                            duration: 5000,
                            isClosable: true,
                            position: "top-right",
                          });
                          onClose();
                        },
                      }
                    );
                  }}
                >
                  Undo
                </Button>
              </HStack>
            ),
            status: "success",
            duration: 10_000,
            isClosable: true,
            position: "top-right",
          });
        },
        onError: () => {
          toast({
            title: "Failed to delete dataset",
            description:
              "There was an error deleting the dataset. Please try again.",
            status: "error",
            duration: 5000,
            isClosable: true,
            position: "top-right",
          });
        },
      }
    );
  };

  const goToDataset = (id: string) => {
    void router.push({
      pathname: `/${project?.slug}/datasets/${id}`,
      query: { ...router.query },
    });
  };

  return (
    <DashboardLayout>
      <Container maxW={"calc(100vw - 200px)"} padding={6} marginTop={8}>
        <HStack width="full" align="top">
          <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={1}>
            Datasets and Evaluations
          </Heading>
          <Spacer />
          <Button
            colorScheme="blue"
            onClick={() => {
              openDrawer("batchEvaluation", {
                selectDataset: true,
              });
            }}
            minWidth="fit-content"
            leftIcon={<Play height={16} />}
          >
            Batch Evaluation
          </Button>
          <Button
            colorScheme="blue"
            onClick={() => {
              onOpen();
            }}
            minWidth="fit-content"
          >
            + Create New Dataset
          </Button>
        </HStack>
        <Card>
          <Tabs>
            <TabList>
              <Tab padding={4}>Datasets</Tab>
              <Tab padding={4}>Batch Evaluations</Tab>
            </TabList>

            <TabPanels>
              <TabPanel padding={0}>
                <CardBody>
                  {datasets.data && datasets.data.length == 0 ? (
                    <Text>No datasets found</Text>
                  ) : (
                    <TableContainer>
                      <Table variant="simple">
                        <Thead>
                          <Tr>
                            <Th>Name</Th>
                            <Th>Schema</Th>
                            <Th>Columns</Th>
                            <Th>Entries</Th>
                            <Th width={240}>Last Update</Th>
                            <Th width={20}></Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {datasets.isLoading
                            ? Array.from({ length: 3 }).map((_, i) => (
                                <Tr key={i}>
                                  {Array.from({ length: 4 }).map((_, i) => (
                                    <Td key={i}>
                                      <Skeleton height="20px" />
                                    </Td>
                                  ))}
                                </Tr>
                              ))
                            : datasets.data
                            ? datasets.data?.map((dataset) => (
                                <Tr
                                  cursor="pointer"
                                  onClick={() => goToDataset(dataset.id)}
                                  key={dataset.id}
                                >
                                  <Td>{dataset.name}</Td>
                                  <Td>{schemaDisplayName(dataset.schema)}</Td>
                                  <Td maxWidth="250px">
                                    <HStack>
                                      {dataset.columns
                                        .split(",")
                                        .map((column) => (
                                          <Tag size="sm">{column}</Tag>
                                        ))}
                                    </HStack>
                                  </Td>
                                  <Td>{dataset.datasetRecords.length ?? 0}</Td>
                                  <Td>
                                    {new Date(
                                      dataset.datasetRecords[0]?.createdAt ??
                                        dataset.createdAt
                                    ).toLocaleString()}
                                  </Td>
                                  <Td>
                                    <Menu>
                                      <MenuButton
                                        as={Button}
                                        variant={"ghost"}
                                        onClick={(event) => {
                                          event.stopPropagation();
                                        }}
                                      >
                                        <MoreVertical />
                                      </MenuButton>
                                      <MenuList>
                                        <MenuItem
                                          color="red.600"
                                          onClick={(event) => {
                                            event.stopPropagation();

                                            deleteDataset(dataset.id);
                                          }}
                                          icon={<DeleteIcon />}
                                        >
                                          Delete dataset
                                        </MenuItem>
                                      </MenuList>
                                    </Menu>
                                  </Td>
                                </Tr>
                              ))
                            : null}
                        </Tbody>
                      </Table>
                    </TableContainer>
                  )}
                </CardBody>
              </TabPanel>
              <TabPanel padding={0}>
                <CardBody>
                  {batchEvaluationRecords.data &&
                  batchEvaluationRecords.data.length == 0 ? (
                    <Text>No records found</Text>
                  ) : (
                    <TableContainer>
                      <Table variant="simple">
                        <Thead>
                          <Tr>
                            <Th>Batch ID</Th>
                            <Th>Dataset</Th>
                            <Th>Entries</Th>
                            <Th>Cost</Th>
                          </Tr>
                        </Thead>
                        <Tbody>
                          {batchEvaluationRecords.isLoading
                            ? Array.from({ length: 3 }).map((_, i) => (
                                <Tr key={i}>
                                  {Array.from({ length: 4 }).map((_, i) => (
                                    <Td key={i}>
                                      <Skeleton height="20px" />
                                    </Td>
                                  ))}
                                </Tr>
                              ))
                            : batchEvaluationRecords.data
                            ? batchEvaluationRecords.data?.map((batch, i) => (
                                <Tr
                                  cursor="pointer"
                                  onClick={() =>
                                    goToBatchEvaluation(batch.batchId)
                                  }
                                  key={i}
                                >
                                  <Td>{batch.batchId}</Td>
                                  <Td>{batch.datasetSlug}</Td>
                                  <Td>{batch._count.batchId}</Td>
                                  <Td>${batch._sum.cost?.toFixed(6)}</Td>
                                </Tr>
                              ))
                            : null}
                        </Tbody>
                      </Table>
                    </TableContainer>
                  )}
                </CardBody>
              </TabPanel>
            </TabPanels>
          </Tabs>
        </Card>
      </Container>
      <AddDatasetDrawer
        isOpen={isOpen}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    </DashboardLayout>
  );
}
