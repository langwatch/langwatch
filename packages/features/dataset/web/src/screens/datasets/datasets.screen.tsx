/**
 * Every dataset in the project: find one, open it, and manage it.
 *
 * Moved from `platform/app/src/pages/[project]/datasets.tsx`. The page's own
 * shape is unchanged — search, the list, the row menu, the two creation flows
 * and the undoable delete — and what it used to read from the application it
 * now asks `DatasetHostPort` for.
 *
 * THE ROW TYPE IS THE CONTRACT'S, NOT THE ROUTER'S. The page inferred it as
 * `inferRouterOutputs<AppRouter>["dataset"]["getAll"][number]`, which a screen
 * closure may not name; `DatasetSummary` is what `listDatasets` returns and
 * therefore what that inference resolved to, so the type moved rather than being
 * restated.
 *
 * TWO OVERLAYS ARE THE SCREEN'S OWN, addressed by its own state rather than
 * through the application's drawer registry: the add-or-edit drawer and the
 * bulk upload drawer. `platform/app`'s `addOrEditDataset` registry entry stays
 * where it is — the workbench, the studio and the add-record drawer all still
 * open it — and this screen never needed the registry, only the component.
 *
 * Spec: specs/datasets/datasets-list-page.feature,
 *       specs/rbac/lite-member-restrictions.feature.
 */

import {
  Badge,
  Box,
  Button,
  HStack,
  Input,
  InputGroup,
  Skeleton,
  Spacer,
  Table,
  Text,
  useDisclosure,
  VStack,
} from "@chakra-ui/react";
import {
  type DatasetColumns,
  datasetColumnsSchema,
  datasetDisplayRecordCount,
  type DatasetSummary,
} from "@langwatch/dataset-contract";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  ChevronDown,
  Copy,
  EllipsisVertical,
  Pencil,
  Plus,
  Search,
  Table as TableIcon,
  Trash2,
  Upload,
} from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { datasetApi } from "../../behavior/dataset-api";
import { useDatasetHost } from "../../model/dataset-host";
import { DeleteDatasetDialog } from "../../ui/blocks/delete-dataset-dialog";
import { NoDataInfoBlock } from "../../ui/elements/no-data-info-block";
import { AddOrEditDatasetDrawer } from "../../ui/sections/add-or-edit-dataset-drawer";
import { BulkUploadDrawer } from "../../ui/sections/bulk-upload-drawer";
import { CopyDatasetDialog } from "../../ui/sections/copy-dataset-dialog";

/** How long the undoable delete notice stands before it goes. */
const DELETE_NOTICE_MS = 10_000;

/**
 * Single entry point for getting data into datasets: a dropdown that splits the
 * two flows — uploading file(s) (one dataset per file, bulk drawer) and creating
 * an empty dataset by defining its columns. The caller supplies the trigger so
 * the same menu backs both the header button and the empty-state CTA.
 */
function UploadOrCreateDatasetMenu({
  children,
  onUpload,
  onCreate,
}: {
  children: ReactNode;
  onUpload: () => void;
  onCreate: () => void;
}) {
  return (
    <Menu.Root positioning={{ sameWidth: true }}>
      <Menu.Trigger asChild>{children}</Menu.Trigger>
      <Menu.Content>
        <Menu.Item value="upload" onClick={onUpload}>
          <Upload size={16} /> Upload datasets
        </Menu.Item>
        <Menu.Item value="create" onClick={onCreate}>
          <Plus size={16} /> Create empty dataset
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

export default function DatasetsScreen() {
  const host = useDatasetHost();
  const project = host.project();
  const isLiteMember = host.isLiteMember();
  const addEditDatasetDrawer = useDisclosure();
  const bulkUploadModal = useDisclosure();
  const utils = datasetApi.useUtils();

  const datasets = datasetApi.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );

  /**
   * `columnTypes` is persisted JSON and older or CLI-created rows can carry an
   * object or a malformed value. A bad row must be displayable and deletable,
   * never crash the whole datasets page.
   */
  const columnsOf = (dataset: DatasetSummary): DatasetColumns => {
    const parsed = datasetColumnsSchema.safeParse(dataset.columnTypes);
    return parsed.success ? parsed.data : [];
  };

  const [search, setSearch] = useState("");
  const filteredDatasets = useMemo(() => {
    if (!datasets.data) return undefined;
    const query = search.trim().toLowerCase();
    if (!query) return datasets.data;
    return datasets.data.filter((dataset) => dataset.name.toLowerCase().includes(query));
  }, [datasets.data, search]);

  const datasetDelete = datasetApi.dataset.deleteById.useMutation();
  const [editDataset, setEditDataset] = useState<
    { datasetId: string; name: string; columnTypes: DatasetColumns } | undefined
  >();
  const [copyDataset, setCopyDataset] = useState<
    { datasetId: string; datasetName: string } | undefined
  >();
  const [datasetToDelete, setDatasetToDelete] = useState<
    { id: string; name: string } | undefined
  >();

  /** Everything the allowance surfaces re-ask once a dataset comes or goes. */
  const invalidateAllowances = () => {
    void datasets.refetch();
    void utils.limits.getUsage.invalidate();
    void utils.licenseEnforcement.checkLimit.invalidate();
  };

  const deleteDataset = ({ id, name }: { id: string; name: string }) => {
    datasetDelete.mutate(
      { projectId: project?.id ?? "", datasetId: id },
      {
        onSuccess: () => {
          invalidateAllowances();
          host.succeeded({
            title: `Dataset ${name} deleted`,
            id: `delete-dataset-${id}`,
            durationMs: DELETE_NOTICE_MS,
            undo: {
              label: "Undo",
              perform: () =>
                datasetDelete.mutate(
                  { projectId: project?.id ?? "", datasetId: id, undo: true },
                  {
                    onSuccess: () => {
                      invalidateAllowances();
                      host.succeeded({
                        title: "Dataset restored",
                        description: "The dataset has been restored.",
                      });
                      addEditDatasetDrawer.onClose();
                    },
                  },
                ),
            },
          });
        },
        onError: (error) => {
          if (host.isReportedGlobally(error)) return;
          host.failed({ error, fallbackTitle: "Failed to delete dataset" });
        },
      },
    );
  };

  const goToDataset = (id: string) => {
    host.navigate(`/${project?.slug}/datasets/${id}`);
  };

  const openCreateDrawer = () => {
    setEditDataset(undefined);
    addEditDatasetDrawer.onOpen();
  };

  return (
    <>
      <PageLayout.Header>
        <PageLayout.Heading>Datasets</PageLayout.Heading>
        <Spacer />
        <InputGroup maxWidth="280px" startElement={<Search size={14} />}>
          <Input
            size="sm"
            placeholder="Search datasets"
            data-testid="datasets-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </InputGroup>
        <UploadOrCreateDatasetMenu
          onUpload={() => bulkUploadModal.onOpen()}
          onCreate={openCreateDrawer}
        >
          <Button variant="outline" size="sm" data-testid="upload-or-create-dataset">
            <Upload height={17} width={17} strokeWidth={2.5} /> Upload or create dataset{" "}
            <ChevronDown size={16} />
          </Button>
        </UploadOrCreateDatasetMenu>
      </PageLayout.Header>
      <Box width="full" maxW="calc(100vw - 200px)" paddingX={6} paddingY={6}>
        {datasets.data && datasets.data.length === 0 ? (
          <NoDataInfoBlock
            title="No datasets yet"
            description="Upload or create datasets on your messages to do further analysis or to train your own models."
            docsInfo={
              <VStack gap={3}>
                <HStack gap={2}>
                  <UploadOrCreateDatasetMenu
                    onUpload={() => bulkUploadModal.onOpen()}
                    onCreate={openCreateDrawer}
                  >
                    <Button colorPalette="orange" data-testid="empty-state-create-dataset">
                      <Upload size={16} /> Upload or create dataset <ChevronDown size={16} />
                    </Button>
                  </UploadOrCreateDatasetMenu>
                </HStack>
                <Text>
                  To learn more about datasets, please visit our{" "}
                  <a
                    href="https://docs.langwatch.ai/datasets/overview"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: "inherit", textDecoration: "underline" }}
                  >
                    documentation
                  </a>
                  .
                </Text>
              </VStack>
            }
            icon={<TableIcon />}
          />
        ) : (
          <ListTable>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Name</Table.ColumnHeader>
                <Table.ColumnHeader>Columns</Table.ColumnHeader>
                <Table.ColumnHeader>Entries</Table.ColumnHeader>
                <Table.ColumnHeader width={240}>Last Update</Table.ColumnHeader>
                <Table.ColumnHeader width={20}></Table.ColumnHeader>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {datasets.isLoading ? (
                Array.from({ length: 3 }).map((_, row) => (
                  <Table.Row key={row}>
                    {Array.from({ length: 4 }).map((__, cell) => (
                      <Table.Cell key={cell}>
                        <Skeleton height="20px" />
                      </Table.Cell>
                    ))}
                  </Table.Row>
                ))
              ) : filteredDatasets && filteredDatasets.length === 0 ? (
                <Table.Row>
                  <Table.Cell colSpan={5}>
                    <Text paddingY={4} color="fg.muted">
                      No datasets match &quot;{search}&quot;
                    </Text>
                  </Table.Cell>
                </Table.Row>
              ) : filteredDatasets ? (
                filteredDatasets.map((dataset) => (
                  <Table.Row
                    key={dataset.id}
                    cursor="pointer"
                    onClick={() => goToDataset(dataset.id)}
                  >
                    <Table.Cell>
                      <HStack gap={2}>
                        <Text>{dataset.name}</Text>
                        {dataset.status === "processing" || dataset.status === "uploading" ? (
                          <Badge size="sm" colorPalette="blue">
                            Processing
                          </Badge>
                        ) : dataset.status === "failed" ? (
                          <Badge size="sm" colorPalette="red">
                            Failed
                          </Badge>
                        ) : null}
                      </HStack>
                    </Table.Cell>
                    <Table.Cell maxWidth="250px">
                      <HStack wrap="wrap">
                        {columnsOf(dataset).map(({ name }) => (
                          <Badge size="sm" key={name}>
                            {name}
                          </Badge>
                        ))}
                      </HStack>
                    </Table.Cell>
                    <Table.Cell>{datasetDisplayRecordCount(dataset)}</Table.Cell>
                    <Table.Cell>
                      {new Date(dataset.updatedAt ?? dataset.createdAt).toLocaleString()}
                    </Table.Cell>
                    <Table.Cell>
                      <Menu.Root>
                        <Menu.Trigger asChild>
                          <Button
                            variant="ghost"
                            aria-label={`Actions for ${dataset.name}`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <EllipsisVertical />
                          </Button>
                        </Menu.Trigger>
                        <Menu.Content>
                          {/* Replicate and Edit operate on dataset CONTENT, which
                              only exists once `ready` — copy and column edits
                              refuse on a processing or failed row. Gate them on
                              ready (a null status = legacy = ready). Delete stays
                              available so a stuck or failed dataset can always be
                              cleaned up. */}
                          {(dataset.status === "ready" || dataset.status == null) && (
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
                              <Copy size={16} /> Replicate to another project
                            </Menu.Item>
                          )}
                          {!isLiteMember && (
                            <>
                              {(dataset.status === "ready" || dataset.status == null) && (
                                <Menu.Item
                                  value="edit"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setEditDataset({
                                      datasetId: dataset.id,
                                      name: dataset.name,
                                      columnTypes: columnsOf(dataset),
                                    });
                                    addEditDatasetDrawer.onOpen();
                                  }}
                                >
                                  <Pencil size={16} /> Edit dataset
                                </Menu.Item>
                              )}
                              <Menu.Item
                                value="delete"
                                color="red.600"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setDatasetToDelete({ id: dataset.id, name: dataset.name });
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
              ) : null}
            </Table.Body>
          </ListTable>
        )}
      </Box>

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

      <BulkUploadDrawer
        open={bulkUploadModal.open}
        onClose={bulkUploadModal.onClose}
        onUploaded={() => {
          void datasets.refetch();
        }}
        onCreateFromScratch={() => {
          bulkUploadModal.onClose();
          openCreateDrawer();
        }}
      />

      <DeleteDatasetDialog
        datasetName={datasetToDelete?.name}
        open={!!datasetToDelete}
        onClose={() => setDatasetToDelete(undefined)}
        onConfirm={() => {
          if (datasetToDelete) deleteDataset(datasetToDelete);
          setDatasetToDelete(undefined);
        }}
      />

      {copyDataset && (
        <CopyDatasetDialog
          open={!!copyDataset}
          onClose={() => setCopyDataset(undefined)}
          datasetId={copyDataset.datasetId}
          datasetName={copyDataset.datasetName}
        />
      )}
    </>
  );
}
