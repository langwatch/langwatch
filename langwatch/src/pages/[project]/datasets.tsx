import {
  Button,
  Card,
  CardBody,
  Container,
  HStack,
  Heading,
  Menu,
  MenuButton,
  MenuItem,
  MenuList,
  Skeleton,
  Spacer,
  Table,
  TableContainer,
  Tag,
  Tbody,
  Td,
  Text,
  Th,
  Thead,
  Tr,
  useDisclosure,
  useToast,
} from "@chakra-ui/react";

import { DeleteIcon } from "@chakra-ui/icons";
import { useRouter } from "next/router";
import { MoreVertical, Play, Upload } from "react-feather";
import { AddOrEditDatasetDrawer } from "../../components/AddOrEditDatasetDrawer";
import { useDrawer } from "../../components/CurrentDrawer";
import { DashboardLayout } from "../../components/DashboardLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import type { DatasetColumns } from "../../server/datasets/types";
import { UploadCSVModal } from "../../components/datasets/UploadCSVModal";

export default function Datasets() {
  const addDatasetDrawer = useDisclosure();
  const uploadCSVModal = useDisclosure();
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const toast = useToast();

  const datasets = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project }
  );

  const datasetDelete = api.dataset.deleteById.useMutation();

  const deleteDataset = (id: string, name: string) => {
    datasetDelete.mutate(
      { projectId: project?.id ?? "", datasetId: id },
      {
        onSuccess: () => {
          void datasets.refetch();
          toast({
            title: `Dataset ${name} deleted`,
            description: (
              <HStack>
                <Button
                  colorScheme="white"
                  variant="link"
                  textDecoration="underline"
                  onClick={() => {
                    toast.close(`delete-dataset-${id}`);
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
                          addDatasetDrawer.onClose();
                        },
                      }
                    );
                  }}
                >
                  Undo
                </Button>
              </HStack>
            ),
            id: `delete-dataset-${id}`,
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
        <HStack width="full" align="top" spacing={6}>
          <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={1}>
            Datasets and Evaluations
          </Heading>
          <Spacer />
          <Button
            onClick={() => uploadCSVModal.onOpen()}
            rightIcon={<Upload height={17} width={17} strokeWidth={2.5} />}
          >
            Upload CSV
          </Button>
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
              addDatasetDrawer.onOpen();
            }}
            minWidth="fit-content"
          >
            + Create New Dataset
          </Button>
        </HStack>
        <Card>
          <CardBody>
            {datasets.data && datasets.data.length == 0 ? (
              <Text>No datasets found</Text>
            ) : (
              <TableContainer>
                <Table variant="simple">
                  <Thead>
                    <Tr>
                      <Th>Name</Th>
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
                            <Td maxWidth="250px">
                              <HStack wrap="wrap">
                                {(
                                  (dataset.columnTypes as DatasetColumns) ?? []
                                ).map(({ name }) => (
                                  <Tag size="sm" key={name}>
                                    {name}
                                  </Tag>
                                ))}
                              </HStack>
                            </Td>
                            <Td>{dataset._count.datasetRecords ?? 0}</Td>
                            <Td>
                              {new Date(dataset.createdAt).toLocaleString()}
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

                                      deleteDataset(dataset.id, dataset.name);
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
        </Card>
      </Container>
      <AddOrEditDatasetDrawer
        isOpen={addDatasetDrawer.isOpen}
        onClose={addDatasetDrawer.onClose}
        onSuccess={() => {
          void datasets.refetch();
          addDatasetDrawer.onClose();
        }}
      />
      <UploadCSVModal
        isOpen={uploadCSVModal.isOpen}
        onClose={uploadCSVModal.onClose}
        onSuccess={() => {
          void datasets.refetch();
          addDatasetDrawer.onClose();
        }}
      />
    </DashboardLayout>
  );
}
