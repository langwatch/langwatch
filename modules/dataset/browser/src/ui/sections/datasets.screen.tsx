/**
 * Every dataset in the project: find, open, manage, via `DatasetHostApi`.
 * Row type is `DatasetSummaryWire`, not a router inference a screen closure
 * can't name. Specs: datasets-list-page, rbac/lite-member-restrictions.feature.
 */

import type { WireOf } from "@langwatch/api/web";
import { datasetClient } from "@langwatch/dataset-client";
import {
  type DatasetColumns,
  datasetColumnsSchema,
  type DatasetSummaryWire,
} from "@langwatch/dataset-contract";
import { FormattedDate } from "@langwatch/design-system/formatted-date";
import { MoreVerticalIcon } from "@langwatch/design-system/icons";
import {
  ListPage,
  type ListPageErrorConfig,
  type ListPageState,
} from "@langwatch/design-system/list-page";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { PageLayout } from "@langwatch/design-system/page-layout";
import {
  Badge,
  Button,
  HStack,
  Skeleton,
  Text,
  useDisclosure,
} from "@langwatch/design-system/primitives";
import { AggregateReadOnlyGate } from "@langwatch/error-views";
import { isAggregateProjectKind } from "@langwatch/project-contract";
import { readableDate } from "@langwatch/time";
import { ChevronDown, Copy, Pencil, Plus, Table as TableIcon, Trash2, Upload } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { datasetApi } from "../../behavior/dataset-api.ts";
import { SetupWithAgentButton } from "../../behavior/lent-setup-with-agent-button.tsx";
import { useDatasetRecordCounts } from "../../behavior/use-dataset-record-counts.ts";
import { useDatasetHost } from "../../model/dataset-host.ts";
import { DeleteDatasetDialog } from "../../ui/blocks/delete-dataset-dialog.tsx";
import { AddOrEditDatasetDrawer } from "./add-or-edit-dataset-drawer.tsx";
import { BulkUploadDrawer } from "./bulk-upload-drawer.tsx";
import { CopyDatasetDialog } from "./copy-dataset-dialog.tsx";

const DATASETS_DOCS = "https://docs.langwatch.ai/datasets/overview";

/**
 * What the list shows, from the read. An aggregate project only ever shows its notice; a
 * failed refresh keeps the rows, and ListPage shows the error inline over them.
 */
function listStateOf({
  isAggregate,
  isError,
  total,
  shown,
}: {
  isAggregate: boolean;
  isError: boolean;
  total: number | undefined;
  shown: number | undefined;
}): ListPageState {
  if (isAggregate) return "ready";
  if (total === undefined) return isError ? "error" : "loading";
  if (total === 0) return "empty";
  return shown === 0 ? "no-results" : "ready";
}

/** How long the undoable delete notice stands before it goes. */
const DELETE_NOTICE_MS = 10_000;

/**
 * Single entry point for getting data into datasets: a dropdown split
 * between uploading file(s) (bulk drawer, one dataset per file) and
 * creating an empty one. The caller supplies the trigger for both header/empty-state use.
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
        <Menu.Item value="upload" data-testid="dataset-menu-upload" onClick={onUpload}>
          <Upload size={16} /> Upload datasets
        </Menu.Item>
        <Menu.Item value="create" data-testid="dataset-menu-create" onClick={onCreate}>
          <Plus size={16} /> Create empty dataset
        </Menu.Item>
      </Menu.Content>
    </Menu.Root>
  );
}

type DatasetRow = WireOf<DatasetSummaryWire>;

function DatasetTable({
  columnsOf,
  datasets,
  goToDataset,
  isLiteMember,
  onCopy,
  onDelete,
  onEdit,
  recordCounts,
  countsFailed,
  slug,
}: {
  columnsOf: (dataset: DatasetRow) => DatasetColumns;
  datasets: DatasetRow[];
  goToDataset: (datasetId: string) => void;
  isLiteMember: boolean;
  onCopy: (target: { datasetId: string; datasetName: string }) => void;
  onDelete: (target: { id: string; name: string }) => void;
  onEdit: (dataset: DatasetRow) => void;
  /** Each dataset's entry count; a missing one is still being counted. */
  recordCounts: ReadonlyMap<string, number>;
  /** The count read gave up: missing counts show as unavailable, not loading. */
  countsFailed: boolean;
  slug: string | undefined;
}) {
  return (
    <ListTable aria-label="Datasets" scroll="x" scrollLabel="Datasets" minWidth="40rem">
      <ListTable.Header>
        <ListTable.Row>
          <ListTable.ColumnHeader>Name</ListTable.ColumnHeader>
          <ListTable.ColumnHeader>Columns</ListTable.ColumnHeader>
          <ListTable.ColumnHeader align="end">Entries</ListTable.ColumnHeader>
          <ListTable.ColumnHeader width={240}>Last updated</ListTable.ColumnHeader>
          <ListTable.ActionHeader label="Dataset actions" />
        </ListTable.Row>
      </ListTable.Header>
      <ListTable.Body>
        {datasets.map((dataset) => (
          <ListTable.Row
            key={dataset.id}
            data-testid={`dataset-row-${dataset.id}`}
            onActivate={() => goToDataset(dataset.id)}
          >
            <ListTable.Cell>
              <HStack gap={2}>
                <ListTable.RowAction
                  href={`/${slug}/datasets/${dataset.id}`}
                  onNavigate={() => goToDataset(dataset.id)}
                >
                  {dataset.name}
                </ListTable.RowAction>
                <DatasetStatusBadge status={dataset.status} />
              </HStack>
            </ListTable.Cell>
            <ListTable.Cell maxWidth="250px">
              <HStack wrap="wrap">
                {columnsOf(dataset).map(({ name }) => (
                  <Badge size="sm" key={name}>
                    <Text as="span" truncate maxWidth="160px" title={name}>
                      {name}
                    </Text>
                  </Badge>
                ))}
              </HStack>
            </ListTable.Cell>
            <ListTable.Cell numeric>
              <RecordCount count={recordCounts.get(dataset.id)} failed={countsFailed} />
            </ListTable.Cell>
            <ListTable.Cell tone="muted">
              <FormattedDate
                value={readableDate(dataset.updatedAt ?? dataset.createdAt).getTime()}
                display="datetime"
              />
            </ListTable.Cell>
            <ListTable.ActionCell>
              <DatasetRowMenu
                dataset={dataset}
                isLiteMember={isLiteMember}
                onCopy={onCopy}
                onDelete={onDelete}
                onEdit={onEdit}
              />
            </ListTable.ActionCell>
          </ListTable.Row>
        ))}
      </ListTable.Body>
    </ListTable>
  );
}

function RecordCount({ count, failed }: { count: number | undefined; failed: boolean }) {
  if (count !== undefined) return <>{count}</>;
  if (failed) {
    return (
      <Text as="span" color="fg.muted" aria-label="Entry count unavailable">
        —
      </Text>
    );
  }

  return (
    <Skeleton
      display="inline-block"
      height="1em"
      width="2.5em"
      verticalAlign="middle"
      aria-label="Counting entries"
    />
  );
}

function DatasetRowMenu({
  dataset,
  isLiteMember,
  onCopy,
  onDelete,
  onEdit,
}: {
  dataset: DatasetRow;
  isLiteMember: boolean;
  onCopy: (target: { datasetId: string; datasetName: string }) => void;
  onDelete: (target: { id: string; name: string }) => void;
  onEdit: (dataset: DatasetRow) => void;
}) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>
        <Button size="xs" variant="ghost" aria-label={`Actions for ${dataset.name}`}>
          <MoreVerticalIcon size={16} aria-hidden />
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
            onClick={() => onCopy({ datasetId: dataset.id, datasetName: dataset.name })}
          >
            <Copy size={16} /> Replicate to another project
          </Menu.Item>
        )}
        {!isLiteMember && (
          <>
            {(dataset.status === "ready" || dataset.status == null) && (
              <Menu.Item value="edit" onClick={() => onEdit(dataset)}>
                <Pencil size={16} /> Edit dataset
              </Menu.Item>
            )}
            <Menu.Item
              value="delete"
              color="fg.error"
              onClick={() => onDelete({ id: dataset.id, name: dataset.name })}
            >
              <Trash2 size={16} /> Delete dataset
            </Menu.Item>
          </>
        )}
      </Menu.Content>
    </Menu.Root>
  );
}

function DatasetStatusBadge({ status }: { status: string | null | undefined }) {
  const isPreparing = status === "processing" || status === "uploading";
  if (isPreparing) {
    return (
      <Badge size="sm" colorPalette="blue">
        Processing
      </Badge>
    );
  }
  if (status !== "failed") return null;

  return (
    <Badge size="sm" colorPalette="red">
      Failed
    </Badge>
  );
}

export default function DatasetsScreen() {
  const host = useDatasetHost();
  const project = host.project();
  const projectIsAggregate = isAggregateProjectKind(project?.kind);
  const isLiteMember = host.isLiteMember();
  const addEditDatasetDrawer = useDisclosure();
  const bulkUploadModal = useDisclosure();
  const utils = datasetApi.useUtils();

  const datasets = datasetClient.dataset.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project },
  );
  const { recordCounts, countsFailed } = useDatasetRecordCounts({
    projectId: project?.id,
    datasets: datasets.data,
  });

  /**
   * `columnTypes` is persisted JSON and older or CLI-created rows can carry an
   * object or a malformed value. A bad row must be displayable and deletable,
   * never crash the whole datasets page.
   */
  const columnsOf = (dataset: WireOf<DatasetSummaryWire>): DatasetColumns => {
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

  const datasetDelete = datasetClient.dataset.deleteById.useMutation();
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

  const listState = listStateOf({
    isAggregate: projectIsAggregate,
    isError: datasets.isError,
    total: datasets.data?.length,
    shown: filteredDatasets?.length,
  });
  const loadError: ListPageErrorConfig = {
    title: "Couldn't load the datasets",
    description: "Try again, or read how datasets work.",
    onRetry: () => void datasets.refetch(),
    next: [{ kind: "docs", label: "Read about datasets", href: DATASETS_DOCS }],
  };
  // ListPage draws any error it is given over loaded rows, so only a failed read passes one.
  const stateProps =
    listState === "error"
      ? { state: listState, error: loadError }
      : { state: listState, ...(datasets.isError ? { error: loadError } : {}) };

  return (
    <>
      <ListPage
        title="Datasets"
        actions={
          projectIsAggregate ? undefined : (
            <UploadOrCreateDatasetMenu
              onUpload={() => bulkUploadModal.onOpen()}
              onCreate={openCreateDrawer}
            >
              <PageLayout.HeaderButton primary data-testid="upload-or-create-dataset">
                <Upload size={16} /> Upload or create dataset <ChevronDown size={16} />
              </PageLayout.HeaderButton>
            </UploadOrCreateDatasetMenu>
          )
        }
        {...stateProps}
        toolbar={
          projectIsAggregate
            ? undefined
            : {
                search: {
                  value: search,
                  onChange: setSearch,
                  placeholder: "Search datasets",
                  ariaLabel: "Search datasets",
                  testId: "datasets-search",
                },
              }
        }
        empty={{
          title: "No datasets yet",
          description:
            "Upload or create datasets on your messages to do further analysis or to train your own models.",
          icon: <TableIcon size={24} />,
          secondaryAction: <SetupWithAgentButton surface="datasets" size="md" />,
          next: [{ kind: "docs", label: "Read about datasets", href: DATASETS_DOCS }],
        }}
        noResults={{
          description: `No datasets match "${search}"`,
          onClear: () => setSearch(""),
          next: [{ kind: "docs", label: "Read about datasets", href: DATASETS_DOCS }],
        }}
      >
        {/* An aggregate (ADR-177) keeps no datasets of its own; the server refuses one. */}
        <AggregateReadOnlyGate isAggregate={projectIsAggregate}>
          <DatasetTable
            columnsOf={columnsOf}
            datasets={filteredDatasets ?? []}
            goToDataset={goToDataset}
            isLiteMember={isLiteMember}
            onCopy={setCopyDataset}
            onDelete={setDatasetToDelete}
            recordCounts={recordCounts}
            countsFailed={countsFailed}
            onEdit={(dataset) => {
              setEditDataset({
                datasetId: dataset.id,
                name: dataset.name,
                columnTypes: columnsOf(dataset),
              });
              addEditDatasetDrawer.onOpen();
            }}
            slug={project?.slug}
          />
        </AggregateReadOnlyGate>
      </ListPage>

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
        onOpenDataset={goToDataset}
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
