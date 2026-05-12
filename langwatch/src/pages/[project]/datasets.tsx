import {
  Badge,
  Button,
  HStack,
  Skeleton,
  Spacer,
  Table,
  Text,
  useDisclosure,
} from "@chakra-ui/react";
import type { inferRouterOutputs } from "@trpc/server";
import { useRouter } from "~/utils/compat/next-router";
import { useState } from "react";
import {
  Copy,
  Edit,
  MoreVertical,
  Play,
  Table as TableIcon,
  Trash2,
  Upload,
} from "react-feather";
import { NoDataInfoBlock } from "~/components/NoDataInfoBlock";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { useDeleteDatasetConfirmation } from "~/hooks/useDeleteDatasetConfirmation";
import { useDrawer } from "~/hooks/useDrawer";
import { AddOrEditDatasetDrawer } from "../../components/AddOrEditDatasetDrawer";
import { DashboardLayout } from "../../components/DashboardLayout";
import { CopyDatasetDialog } from "../../components/datasets/CopyDatasetDialog";
import { UploadCSVModal } from "../../components/datasets/UploadCSVModal";
import { Link } from "../../components/ui/link";
import { Menu } from "../../components/ui/menu";
import { toaster } from "../../components/ui/toaster";
import { useLiteMemberGuard } from "../../hooks/useLiteMemberGuard";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import type { AppRouter } from "../../server/api/root";
import type { DatasetColumns } from "../../server/datasets/types";
import { api } from "../../utils/api";
import { isHandledByGlobalHandler } from "../../utils/trpcError";

function DatasetsPage() {
  const addEditDatasetDrawer = useDisclosure();
  const uploadCSVModal = useDisclosure();
  const { project } = useOrganizationTeamProject();
  const { isLiteMember } = useLiteMemberGuard();
  const router = useRouter();
  const { openDrawer } = useDrawer();
  const queryClient = api.useContext();

  const datasets = api.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  type Dataset = inferRouterOutputs<AppRouter>["dataset"]["getAll"][number];

  const datasetDelete = api.dataset.deleteById.useMutation();
  const [editDataset, setEditDataset] = useState<
    | {
        datasetId: string;
        name: string;
        columnTypes: DatasetColumns;
      }
    | undefined
  >();
  const [copyDataset, setCopyDataset] = useState<{
    datasetId: string;
    datasetName: string;
  } | null>(null);

  const deleteDataset = ({ id, name }: { id: string; name: string }) => {
    datasetDelete.mutate(
      { projectId: project?.id ?? "", datasetId: id },
      {
        onSuccess: () => {
          void datasets.refetch();
          void queryClient.limits.getUsage.invalidate();
          void queryClient.licenseEnforcement.checkLimit.invalidate();
          toaster.create({
            title: `Dataset ${name} deleted`,
            description: (
              <HStack>
                <Button
                  color="white"
                  padding={0}
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
                          void queryClient.limits.getUsage.invalidate();
                          void queryClient.licenseEnforcement.checkLimit.invalidate();
                          toaster.create({
                            title: "Dataset restored",
                            description: "The dataset has been restored.",
                            type: "success",
                            meta: {
                              closable: true,
                            },
                          });
                          addEditDatasetDrawer.onClose();
                        },
                      },
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
          });
        },
        onError: (error) => {
          if (isHandledByGlobalHandler(error)) return;
          toaster.create({
            title: "Failed to delete dataset",
            description:
              "There was an error deleting the dataset. Please try again.",
            type: "error",
            duration: 5000,
            meta: {
              closable: true,
            },
          });
        },
      },
    );
  };

  const { showDeleteDialog, DeleteDialog } =
    useDeleteDatasetConfirmation(deleteDataset);

  const goToDataset = (id: string) => {
    void router.push({
      pathname: `/${project?.slug}/datasets/${id}`,
      query: { ...router.query },
    });
  };

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <PageLayout.Heading>Datasets</PageLayout.Heading>
        <Spacer />
        <PageLayout.HeaderButton
          onClick={() => {
            openDrawer("batchEvaluation", {
              selectDataset: true,
            });
          }}
        >
          <Play height={16} /> Batch Evaluation
        </PageLayout.HeaderButton>
        <PageLayout.HeaderButton
          onClick={() => uploadCSVModal.onOpen()}
        >
          <Upload height={17} width={17} strokeWidth={2.5} /> Upload or Create
          Dataset
        </PageLayout.HeaderButton>
      </PageLayout.Header>
      <PageLayout.Container maxW={"calc(100vw - 200px)"}>
        <PageLayout.Content>
          {datasets.data && datasets.data.length === 0 ? (
            <NoDataInfoBlock
              title="No datasets yet"
              description="Upload or create datasets on your messages to do further analysis or to train your own models."
              docsInfo={
                <Text>
                  To learn more about datasets, please visit our{" "}
                  <Link
                    color="orange.400"
                    href="https://docs.langwatch.ai/datasets/overview"
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
                    ? datasets.data.map((dataset: Dataset) => (
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
                            {dataset.useS3
                              ? (dataset.s3RecordCount ?? 0)
                              : (dataset._count.datasetRecords ?? 0)}
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
                                    value="copy"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      setCopyDataset({
                                        datasetId: dataset.id,
                                        datasetName: dataset.name,
                                      });
                                    }}
                                  >
                                    <Copy size={16} /> Replicate to another
                                    project
                                  </Menu.Item>
                                  {!isLiteMember && (
                                    <>
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
                                          showDeleteDialog({
                                            id: dataset.id,
                                            name: dataset.name,
                                          });
                                        }}
                                      >
                                        <Trash2 size={16} /> Delete dataset
                                      </Menu.Item>
                                    </>
                                  )}
                              </Menu.Content>
                            </Menu.Root>
                          </Table.Cell>
                        </Table.Row>
                      ))
                    : null}
              </Table.Body>
            </Table.Root>
          )}
        </PageLayout.Content>
      </PageLayout.Container>
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
          setTimeout(() => {
            addEditDatasetDrawer.onOpen();
          }, 100);
        }}
      />
      <DeleteDialog />
      {copyDataset && (
        <CopyDatasetDialog
          open={!!copyDataset}
          onClose={() => setCopyDataset(null)}
          datasetId={copyDataset.datasetId}
          datasetName={copyDataset.datasetName}
        />
      )}
    </DashboardLayout>
  );
}

export default withPermissionGuard("datasets:view", {
  layoutComponent: DashboardLayout,
})(DatasetsPage);
