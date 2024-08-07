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
  useToast
} from "@chakra-ui/react";

import { DeleteIcon } from "@chakra-ui/icons";
import { useRouter } from "next/router";
import { MoreVertical, Play } from "react-feather";
import { AddDatasetDrawer } from "~/components/AddDatasetDrawer";
import { useDrawer } from "~/components/CurrentDrawer";
import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { schemaDisplayName } from "~/utils/datasets";

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

  const onSuccess = () => {
    void datasets.refetch();
    onClose();
  };

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
                              <HStack wrap="wrap">
                                {dataset.columns.split(",").map((column) => (
                                  <Tag size="sm" key={column}>
                                    {column}
                                  </Tag>
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
      <AddDatasetDrawer
        isOpen={isOpen}
        onClose={onClose}
        onSuccess={onSuccess}
      />
    </DashboardLayout>
  );
}
