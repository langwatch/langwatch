import {
  Badge,
  Button,
  Card,
  Container,
  HStack,
  Heading,
  Skeleton,
  Spacer,
  Table,
  Text,
  useDisclosure,
} from "@chakra-ui/react";

import { useRouter } from "next/router";
import {
  MoreVertical,
  Play,
  Upload,
  Table as TableIcon,
  Edit,
  Trash2,
} from "react-feather";
import { AddOrEditDatasetDrawer } from "../../components/AddOrEditDatasetDrawer";
import { useDrawer } from "../../components/CurrentDrawer";
import { DashboardLayout } from "../../components/DashboardLayout";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { api } from "../../utils/api";
import type { DatasetColumns } from "../../server/datasets/types";
import { UploadCSVModal } from "../../components/datasets/UploadCSVModal";
import { useState } from "react";
import { NoDataInfoBlock } from "~/components/NoDataInfoBlock";
import { Link } from "../../components/ui/link";
import { Menu } from "../../components/ui/menu";
import { toaster } from "../../components/ui/toaster";

export default function Datasets() {
  const addEditDatasetDrawer = useDisclosure();
  const uploadCSVModal = useDisclosure();
  const { project } = useOrganizationTeamProject();
  const router = useRouter();
  const { openDrawer } = useDrawer();

  const datasets = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project }
  );

  const datasetDelete = api.dataset.deleteById.useMutation();
  const [editDataset, setEditDataset] = useState<
    | {
        datasetId: string;
        name: string;
        columnTypes: DatasetColumns;
      }
    | undefined
  >();

  const deleteDataset = (id: string, name: string) => {
    datasetDelete.mutate(
      { projectId: project?.id ?? "", datasetId: id },
      {
        onSuccess: () => {
          void datasets.refetch();
          toaster.create({
            title: `Dataset ${name} deleted`,
            description: (
              <HStack>
                <Button
                  colorPalette="white"
                  variant="plain"
                  textDecoration="underline"
                  onClick={() => {
                    toaster.dismiss(`delete-dataset-${id}`);
                    datasetDelete.mutate(
                      {
                        projectId: project?.id ?? "",
                        datasetId: id,
                        undo: true,
                      },
                      {
                        onSuccess: () => {
                          void datasets.refetch();
                          toaster.create({
                            title: "Dataset restored",
                            description: "The dataset has been restored.",
                            type: "success",
                            meta: {
                              closable: true,
                            },
                            placement: "top-end",
                          });
                          addEditDatasetDrawer.onClose();
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
            type: "success",
            duration: 10_000,
            meta: {
              closable: true,
            },
            placement: "top-end",
          });
        },
        onError: () => {
          toaster.create({
            title: "Failed to delete dataset",
            description:
              "There was an error deleting the dataset. Please try again.",
            type: "error",
            duration: 5000,
            meta: {
              closable: true,
            },
            placement: "top-end",
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
        <HStack width="full" align="top" gap={6}>
          <Heading as={"h1"} size="lg" paddingBottom={6} paddingTop={1}>
            Datasets and Evaluations
          </Heading>
          <Spacer />
          <Button
            colorPalette="blue"
            onClick={() => {
              openDrawer("batchEvaluation", {
                selectDataset: true,
              });
            }}
            minWidth="fit-content"
          >
            <Play height={16} /> Batch Evaluation
          </Button>
          <Button
            colorPalette="blue"
            onClick={() => uploadCSVModal.onOpen()}
            minWidth="fit-content"
          >
            <Upload height={17} width={17} strokeWidth={2.5} /> Upload or Create
            Dataset
          </Button>
        </HStack>
        <Card.Root>
          <Card.Body>
            {datasets.data && datasets.data.length == 0 ? (
              <NoDataInfoBlock
                title="No datasets yet"
                description="Upload or create datasets on your messages to do further analysis or to train your own models."
                docsInfo={
                  <Text>
                    To learn more about datasets, please visit our{" "}
                    <Link
                      color="orange.400"
                      href="https://docs.langwatch.ai/features/datasets"
                      isExternal
                    >
                      documentation
                    </Link>
                    .
                  </Text>
                }
                icon={<TableIcon />}
              />
            ) : (
              <Table.Root variant="line">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader>Name</Table.ColumnHeader>
                    <Table.ColumnHeader>Columns</Table.ColumnHeader>
                    <Table.ColumnHeader>Entries</Table.ColumnHeader>
                    <Table.ColumnHeader width={240}>
                      Last Update
                    </Table.ColumnHeader>
                    <Table.ColumnHeader width={20}></Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {datasets.isLoading
                    ? Array.from({ length: 3 }).map((_, i) => (
                        <Table.Row key={i}>
                          {Array.from({ length: 4 }).map((_, i) => (
                            <Table.Cell key={i}>
                              <Skeleton height="20px" />
                            </Table.Cell>
                          ))}
                        </Table.Row>
                      ))
                    : datasets.data
                    ? datasets.data?.map((dataset) => (
                        <Table.Row
                          cursor="pointer"
                          onClick={() => goToDataset(dataset.id)}
                          key={dataset.id}
                        >
                          <Table.Cell>{dataset.name}</Table.Cell>
                          <Table.Cell maxWidth="250px">
                            <HStack wrap="wrap">
                              {(
                                (dataset.columnTypes as DatasetColumns) ?? []
                              ).map(({ name }) => (
                                <Badge size="sm" key={name}>
                                  {name}
                                </Badge>
                              ))}
                            </HStack>
                          </Table.Cell>
                          <Table.Cell>
                            {dataset._count.datasetRecords ?? 0}
                          </Table.Cell>
                          <Table.Cell>
                            {new Date(dataset.createdAt).toLocaleString()}
                          </Table.Cell>
                          <Table.Cell>
                            <Menu.Root>
                              <Menu.Trigger asChild>
                                <Button
                                  variant={"ghost"}
                                  onClick={(event) => {
                                    event.stopPropagation();
                                  }}
                                >
                                  <MoreVertical />
                                </Button>
                              </Menu.Trigger>
                              <Menu.Content>
                                <Menu.Item
                                  value="edit"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setEditDataset({
                                      datasetId: dataset.id,
                                      name: dataset.name,
                                      columnTypes:
                                        dataset.columnTypes as DatasetColumns,
                                    });
                                    addEditDatasetDrawer.onOpen();
                                  }}
                                >
                                  <Edit size={16} /> Edit dataset
                                </Menu.Item>
                                <Menu.Item
                                  value="delete"
                                  color="red.600"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    deleteDataset(dataset.id, dataset.name);
                                  }}
                                >
                                  <Trash2 size={16} /> Delete dataset
                                </Menu.Item>
                              </Menu.Content>
                            </Menu.Root>
                          </Table.Cell>
                        </Table.Row>
                      ))
                    : null}
                </Table.Body>
              </Table.Root>
            )}
          </Card.Body>
        </Card.Root>
      </Container>
      <AddOrEditDatasetDrawer
        open={addEditDatasetDrawer.open}
        onClose={() => {
          setEditDataset(undefined);
          addEditDatasetDrawer.onClose();
        }}
        datasetToSave={editDataset}
        onSuccess={() => {
          void datasets.refetch();
          setEditDataset(undefined);
          addEditDatasetDrawer.onClose();
        }}
      />
      <UploadCSVModal
        isOpen={uploadCSVModal.open}
        onClose={uploadCSVModal.onClose}
        onSuccess={() => {
          void datasets.refetch();
        }}
        onCreateFromScratch={() => {
          uploadCSVModal.onClose();
          addEditDatasetDrawer.onOpen();
        }}
      />
    </DashboardLayout>
  );
}
