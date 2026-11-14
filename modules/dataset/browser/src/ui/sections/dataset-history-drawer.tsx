/**
 * The dataset's version history as a routed drawer: list and save versions, view one's rows,
 * compare it with the current content and restore it.
 * Spec: modules/dataset/specs/dataset-versioning.feature.
 */

import { useDrawer } from "@langwatch/browser-host/drawer";
import type { UiDatasetHistoryDrawerProps } from "@langwatch/dataset-client";
import { ConfirmDialog } from "@langwatch/design-system/confirm-dialog";
import { Drawer, type DrawerFooterProps } from "@langwatch/design-system/drawer";
import { HistoryIcon } from "@langwatch/design-system/history-icon";
import { Pagination } from "@langwatch/design-system/pagination";
import { Button, HStack, Input, Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  useDatasetVersionComparison,
  useDatasetVersionPage,
  useDatasetVersions,
  useHistoryDataset,
  useRestoreDatasetVersion,
  useSaveDatasetVersion,
} from "../../behavior/use-dataset-history.ts";
import { useDatasetHost } from "../../model/dataset-host.ts";
import {
  restoreBlockedReason,
  restoredVersionNotice,
  rowCountLabel,
  savedVersionNotice,
  versionAuthorLabel,
  versionColumnNames,
  versionTitle,
  versionTriggerLabel,
  type DatasetVersionListItem,
} from "../../model/dataset-version-history.ts";
import { DatasetVersionComparison } from "../blocks/dataset-version-comparison.tsx";
import { DatasetVersionList } from "../blocks/dataset-version-list.tsx";
import { DatasetVersionRowsTable } from "../blocks/dataset-version-rows-table.tsx";

const UPDATE_PERMISSION = "datasets:update";
/** A restore can change the column set, which is administering the dataset. */
const MANAGE_PERMISSION = "datasets:manage";
const VERSION_NAME_MAX = 120;
const ROWS_PAGE_SIZE = 25;

type HistoryView =
  | { kind: "list" }
  | { kind: "rows"; version: DatasetVersionListItem }
  | { kind: "compare"; version: DatasetVersionListItem };

export function DatasetHistoryDrawer({ datasetId, onClose }: UiDatasetHistoryDrawerProps) {
  const { closeDrawer } = useDrawer();
  const close = onClose ?? closeDrawer;
  const host = useDatasetHost();
  const projectId = host.project()?.id;
  const scope = { projectId, datasetId };
  const canUpdate = host.hasPermission(UPDATE_PERMISSION);
  const canManage = host.hasPermission(MANAGE_PERMISSION);

  const [view, setView] = useState<HistoryView>({ kind: "list" });
  const [pendingRestore, setPendingRestore] = useState<DatasetVersionListItem | null>(null);
  const [rowsPage, setRowsPage] = useState(1);
  const showVersion = (next: HistoryView) => {
    setRowsPage(1);
    setView(next);
  };

  const dataset = useHistoryDataset(scope);
  const versions = useDatasetVersions(scope);
  const { restore, isRestoring } = useRestoreDatasetVersion(scope);
  const rowsRead = useDatasetVersionPage({
    ...scope,
    version: view.kind === "rows" ? view.version.version : undefined,
    page: rowsPage,
    limit: ROWS_PAGE_SIZE,
  });
  const comparison = useDatasetVersionComparison({
    ...scope,
    version: view.kind === "compare" ? view.version.version : undefined,
  });

  const versionList = versions.data?.versions;
  const latestVersion = versionList?.[0]?.version;
  const restoreSupported = versions.data?.restorable ?? true;
  const blockedReason = (version: DatasetVersionListItem) =>
    restoreBlockedReason({
      version: version.version,
      latestVersion,
      restoreSupported,
      canManage,
    });
  const authorLabel = (version: DatasetVersionListItem) =>
    versionAuthorLabel({
      authorKind: version.authorKind,
      authorId: version.authorId,
      authorName: version.authorName,
      currentUserId: host.currentUserId(),
    });

  const confirmRestore = async () => {
    if (!pendingRestore) return;
    const { version } = pendingRestore;
    try {
      const restored = await restore({ version });
      host.succeeded(restoredVersionNotice({ version, restored }));
      setPendingRestore(null);
      showVersion({ kind: "list" });
    } catch (error) {
      host.failed({ error, fallbackTitle: `Couldn't restore version ${version}` });
    }
  };

  const restoreAction = (version: DatasetVersionListItem) => {
    const reason = blockedReason(version);
    return {
      label: "Restore this version",
      onClick: () => setPendingRestore(version),
      ...(reason ? { disabledReason: reason } : {}),
    };
  };

  const toList = () => showVersion({ kind: "list" });
  let frame: HistoryFrame;
  if (view.kind === "rows") {
    frame = rowsFrame({
      version: view.version,
      authorLabel: authorLabel(view.version),
      read: rowsRead,
      page: rowsPage,
      onPageChange: setRowsPage,
      onBack: toList,
      onCompare: () => showVersion({ kind: "compare", version: view.version }),
      restoreAction: restoreAction(view.version),
    });
  } else if (view.kind === "compare") {
    frame = compareFrame({
      version: view.version,
      comparison,
      onBack: toList,
      restoreAction: restoreAction(view.version),
    });
  } else {
    frame = listFrame({
      datasetName: dataset.data?.name,
      versions,
      toolbar: <SaveVersionForm scope={scope} canUpdate={canUpdate} latest={latestVersion} />,
      list: (
        <DatasetVersionList
          versions={versionList ?? []}
          authorLabel={authorLabel}
          restoreBlockedReason={blockedReason}
          onView={(version) => showVersion({ kind: "rows", version })}
          onCompare={(version) => showVersion({ kind: "compare", version })}
          onRestore={(version) => setPendingRestore(version)}
        />
      ),
    });
  }

  const { body, ...chrome } = frame;

  return (
    <>
      <Drawer
        {...chrome}
        icon={<HistoryIcon size={20} />}
        onClose={close}
        data-testid="dataset-history-drawer"
        entityKey={view.kind === "list" ? "list" : `${view.kind}:${view.version.id}`}
      >
        {body}
      </Drawer>
      <RestoreConfirmDialog
        version={pendingRestore?.version}
        loading={isRestoring}
        onClose={() => setPendingRestore(null)}
        onConfirm={() => void confirmRestore()}
      />
    </>
  );
}

type Scope = { projectId: string | undefined; datasetId: string };
type RestoreAction = { label: string; onClick: () => void; disabledReason?: string };

/** What one view hands the drawer: its header, footer and body. */
type HistoryFrame = {
  title: string;
  subtitle?: ReactNode;
  size: "lg" | "xl";
  onBack?: () => void;
  toolbar?: ReactNode;
  loading?: boolean;
  error?: { title: string; onRetry: () => void };
  footer?: DrawerFooterProps;
  body: ReactNode;
};

/** The list view: the versions, with the save form pinned under the header. */
function listFrame({
  datasetName,
  versions,
  toolbar,
  list,
}: {
  datasetName: string | undefined;
  versions: ReturnType<typeof useDatasetVersions>;
  toolbar: ReactNode;
  list: ReactNode;
}): HistoryFrame {
  const empty = versions.data?.versions.length === 0;
  return {
    title: "Version history",
    subtitle: datasetName,
    size: "lg",
    toolbar,
    loading: versions.isLoading,
    error: versions.isError
      ? { title: "Couldn't load the version history", onRetry: () => void versions.refetch() }
      : undefined,
    body: empty ? (
      <Text color="fg.muted">
        No versions yet. Save one to keep a copy of the current rows and columns.
      </Text>
    ) : (
      list
    ),
  };
}

/** One version's rows, read-only, with restore and compare in the footer. */
function rowsFrame({
  version,
  authorLabel,
  read,
  page,
  onPageChange,
  onBack,
  onCompare,
  restoreAction,
}: {
  version: DatasetVersionListItem;
  authorLabel: string;
  read: ReturnType<typeof useDatasetVersionPage>;
  page: number;
  onPageChange: (page: number) => void;
  onBack: () => void;
  onCompare: () => void;
  restoreAction: RestoreAction;
}): HistoryFrame {
  return {
    title: versionTitle(version),
    subtitle: `${versionTriggerLabel(version)} by ${authorLabel} · ${rowCountLabel(version.rowCount)}`,
    size: "xl",
    onBack,
    error: read.isError
      ? { title: "Couldn't load this version's rows", onRetry: () => void read.refetch() }
      : undefined,
    footer: {
      primaryAction: restoreAction,
      secondaryAction: { label: "Compare with current", onClick: onCompare },
    },
    body: <VersionRows version={version} read={read} page={page} onPageChange={onPageChange} />,
  };
}

/** What changed since the version, with restore in the footer. */
function compareFrame({
  version,
  comparison,
  onBack,
  restoreAction,
}: {
  version: DatasetVersionListItem;
  comparison: ReturnType<typeof useDatasetVersionComparison>;
  onBack: () => void;
  restoreAction: RestoreAction;
}): HistoryFrame {
  return {
    title: `Compare version ${version.version} with current`,
    subtitle: version.name ?? versionTriggerLabel(version),
    size: "xl",
    onBack,
    loading: comparison.isLoading,
    error: comparison.isError
      ? { title: "Couldn't compare this version", onRetry: () => void comparison.refetch() }
      : undefined,
    footer: { primaryAction: restoreAction },
    body: comparison.data ? (
      <DatasetVersionComparison comparison={comparison.data} columnOrder={version.columnTypes} />
    ) : null,
  };
}

function RestoreConfirmDialog({
  version,
  loading,
  onClose,
  onConfirm,
}: {
  version: number | undefined;
  loading: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  // Keeps the number in the copy while the dialog animates out after `version` clears.
  const shown = useRef(version);
  if (version !== undefined) shown.current = version;
  return (
    <ConfirmDialog
      open={version !== undefined}
      onClose={onClose}
      onConfirm={onConfirm}
      loading={loading}
      tone="default"
      title={`Restore version ${shown.current ?? ""}?`}
      confirmLabel="Restore"
      description={`The dataset's rows and columns go back to version ${shown.current ?? ""}. This is saved as a new version, so the current content stays in the history.`}
    />
  );
}

function SaveVersionForm({
  scope,
  canUpdate,
  latest,
}: {
  scope: Scope;
  canUpdate: boolean;
  latest: number | undefined;
}) {
  const host = useDatasetHost();
  const { save, isSaving } = useSaveDatasetVersion(scope);
  const [name, setName] = useState("");

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    try {
      const saved = await save(trimmed ? { name: trimmed } : {});
      host.succeeded(savedVersionNotice({ saved, previousLatest: latest }));
      setName("");
    } catch (error) {
      host.failed({ error, fallbackTitle: "Couldn't save a version" });
    }
  };

  const button = (
    <Button type="submit" size="sm" loading={isSaving} disabled={!canUpdate}>
      Save version
    </Button>
  );

  return (
    <form onSubmit={(event) => void submit(event)} aria-label="Save a version">
      <HStack gap={2} width="full">
        <Input
          size="sm"
          flex={1}
          value={name}
          maxLength={VERSION_NAME_MAX}
          placeholder="Name this version (optional)"
          aria-label="Version name"
          disabled={!canUpdate || isSaving}
          onChange={(event) => setName(event.target.value)}
        />
        {canUpdate ? (
          button
        ) : (
          <Tooltip content="You need permission to edit this dataset to save a version.">
            <span>{button}</span>
          </Tooltip>
        )}
      </HStack>
    </form>
  );
}

function VersionRows({
  version,
  read,
  page,
  onPageChange,
}: {
  version: DatasetVersionListItem;
  read: ReturnType<typeof useDatasetVersionPage>;
  page: number;
  onPageChange: (page: number) => void;
}) {
  const rows = read.data?.rows ?? [];
  const total = read.data?.pagination.total ?? 0;
  const columns = versionColumnNames({ columns: version.columnTypes, rows });
  if (!read.isLoading && rows.length === 0) {
    return <Text color="fg.muted">This version has no rows.</Text>;
  }
  return (
    <VStack align="stretch" gap={3}>
      <DatasetVersionRowsTable
        label={`Rows of version ${version.version}`}
        columns={columns}
        rows={rows}
        isLoading={read.isLoading}
      />
      {total > ROWS_PAGE_SIZE && (
        <Pagination
          page={page}
          pageSize={ROWS_PAGE_SIZE}
          totalCount={total}
          onPageChange={onPageChange}
          isLoading={read.isFetching}
          unitLabel="rows"
        />
      )}
    </VStack>
  );
}
