/**
 * The list every annotation view renders: the header controls, the table, the
 * pager and what the reviewer can do with the rows they picked.
 *
 * MOVED from `platform/app/src/components/annotations/AnnotationsTable.tsx`,
 * which was exclusive to the four page files this screen replaces and so is
 * deleted rather than copied. Its shape is unchanged — the status filter, the
 * date range, the export, the paging, the selection bar and the three bulk
 * actions — and what it used to read from the application it now takes as
 * props, resolved once by the screen from `AnnotationHostPort`.
 *
 * TWO THINGS THAT USED TO BE CLOSURES ARE MODULES NOW, because both are rules
 * rather than rendering and neither had a test that did not first mount a
 * table: the paging (`model/annotation-list-paging.ts`) and the export
 * (`model/annotation-export.ts`).
 *
 * THE ROW ACTIONS THAT OPEN AN APPLICATION OVERLAY WRITE AN ADDRESS. Viewing a
 * trace and handing rows to a dataset were `openDrawer` calls; they are query
 * writes now (`model/annotation-overlay-address.ts`), which is the same intent
 * and carries the chrome gap recorded there.
 *
 * Spec: packages/features/annotation/specs/annotations-list-selection.feature.
 */

import { Box, Button, Flex, Heading, HStack, Spacer, Text, VStack } from "@chakra-ui/react";
import { ListTable } from "@langwatch/design-system/list-table";
import { Menu } from "@langwatch/design-system/menu";
import { Pagination } from "@langwatch/design-system/pagination";
import { Radio, RadioGroup } from "@langwatch/design-system/radio";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { ChevronDown, Database, Download, Inbox, SquarePen, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { annotationApi } from "../../behavior/annotation-api";
import { useAnnotationPeriod } from "../../behavior/use-annotation-period";
import { useAnnotationQueues } from "../../behavior/use-annotation-queues";
import { useFieldRedaction } from "../../behavior/use-field-redaction";
import { usePersonalDatasetGate } from "../../behavior/use-personal-feature-gate";
import {
  annotationListExport,
  csvFileName,
  type ActiveScoreType,
} from "../../model/annotation-export";
import type { AnnotationHostPort } from "../../model/annotation-host";
import {
  pageAddress,
  pageSizeAddress,
  readAnnotationListPaging,
} from "../../model/annotation-list-paging";
import {
  addDatasetRecordAddress,
  queueEditorAddress,
  queueItemHref,
  traceDetailsAddress,
} from "../../model/annotation-overlay-address";
import {
  absolutePeriodAddress,
  clearedPeriodAddress,
  relativePeriodAddress,
} from "../../model/annotation-period";
import { queueItemsToRows, type AnnotationRow } from "../../model/annotation-row";
import { annotationViewCopy, viewReadsMemberQueues } from "../../model/annotation-view";
import type { AnnotationView } from "../../model/annotation-view";
import { AnnotationTable, AnnotationTableSkeleton } from "../blocks/annotation-table";
import { PersonalFeatureGateDialog } from "../blocks/personal-feature-gate-dialog";
import { Link } from "../elements/annotation-link";
import { NoDataInfoBlock } from "../elements/no-data-info-block";
import { PeriodPicker } from "../elements/period-picker";
import { RedactedField } from "../elements/redacted-field";
import { ReviewerAvatar } from "../elements/reviewer-avatar";
import { SelectionActionBar } from "../elements/selection-action-bar";
import { SendToQueueDialog } from "./send-to-queue-dialog";
import { downloadCsv } from "../../behavior/download-csv";

/**
 * The list this page IS, named the way the queue reads name participants
 * (`queue-<id>` for a named queue, `user-<id>` for a reviewer's own inbox).
 * A page that is a queue MOVES its selection to another queue rather than only
 * adding it to one.
 */
export type PageQueue = { annotatorId: string; name: string };

export function AnnotationList({
  view,
  host,
  /** The queue this list is, when the view is one. */
  queueId,
  pageQueue,
  titleContent,
  /**
   * Rows supplied by the screen instead of read from the queues. The whole
   * list: this component pages through it.
   */
  rows: providedRows,
  rowsLoading,
  /** Replaces "export what is on screen" with the screen's own export. */
  exportLabel,
  onExport,
}: {
  view: AnnotationView;
  host: AnnotationHostPort;
  queueId?: string;
  pageQueue?: PageQueue;
  /** Richer title area, for the queue view's name plus its members. */
  titleContent?: ReactNode;
  rows?: AnnotationRow[];
  rowsLoading?: boolean;
  exportLabel?: string;
  onExport?: () => void;
}) {
  const copy = annotationViewCopy(view);
  const project = host.project();
  const query = host.route().query;
  const paging = readAnnotationListPaging(query);

  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});

  const isPageProvidedRows = providedRows !== void 0;

  const { period, mode: periodMode, isDefault: periodIsDefault } = useAnnotationPeriod(query);

  // A queue is a list of work still to do, and the sidebar badge counts all of
  // it, so a default window that quietly dropped older items would leave the
  // badge and the list disagreeing. The range narrows the read only once the
  // reviewer has picked one; until then the control says so and reads "All
  // time".
  const rangeIsPicked = !periodIsDefault;
  const queuedRange = rangeIsPicked ? period : {};
  // The range as a value rather than two Date objects, so effects keyed on it
  // fire when the window changes and not merely when it is re-derived.
  const queuedRangeKey = rangeIsPicked
    ? `${period.startDate.getTime()}-${period.endDate.getTime()}`
    : "all";

  const setQuery = useCallback(
    (next: Record<string, string | undefined>) => host.setQuery(next),
    [host],
  );

  const { assignedQueueItems, queuesLoading, totalCount } = useAnnotationQueues({
    projectId: project?.id,
    selectedAnnotations: statusFilter,
    ...(queueId ? { queueId } : {}),
    showQueueAndUser: viewReadsMemberQueues(view),
    pageOffset: paging.pageOffset,
    pageSize: paging.pageSize,
    ...queuedRange,
    enabled: !isPageProvidedRows,
  });

  const scoreTypes = annotationApi.annotationScore.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id },
  );

  const activeScoreTypes: ActiveScoreType[] = useMemo(
    () =>
      (scoreTypes.data ?? [])
        .filter((scoreType) => scoreType.active)
        .map((scoreType) => ({ id: scoreType.id, name: scoreType.name })),
    [scoreTypes.data],
  );

  const redaction = useFieldRedaction({
    projectId: project?.id,
    canRead: host.hasPermission("project:view"),
  });

  // A page that brings its own rows brings all of them, so the pager slices
  // them here; the queue read is already paged by the server.
  const allRows: AnnotationRow[] = useMemo(
    () => providedRows ?? queueItemsToRows(assignedQueueItems),
    [providedRows, assignedQueueItems],
  );
  const pageRows = useMemo(
    () =>
      isPageProvidedRows
        ? allRows.slice(paging.pageOffset, paging.pageOffset + paging.pageSize)
        : allRows,
    [allRows, isPageProvidedRows, paging.pageOffset, paging.pageSize],
  );
  const rowCount = isPageProvidedRows ? allRows.length : totalCount;
  const isLoading = isPageProvidedRows ? !!rowsLoading : queuesLoading;

  // A selection only means something for the rows it was made on. Filtering,
  // paging or switching queue swaps those rows out, so the picks go with them.
  useEffect(() => {
    setRowSelection({});
  }, [statusFilter, queueId, paging.pageOffset, paging.pageSize, queuedRangeKey]);

  const datasetGate = usePersonalDatasetGate({
    projectId: project?.id,
    isOwnPersonalWorkspace: host.isOwnPersonalWorkspace(),
  });

  const utils = annotationApi.useUtils();
  const refreshQueues = useCallback(async () => {
    await Promise.all([
      utils.annotation.getOptimizedAnnotationQueues.invalidate(),
      utils.annotation.getPendingItemsCount.invalidate(),
      utils.annotation.getAssignedItemsCount.invalidate(),
      utils.annotation.getQueueItemsCounts.invalidate(),
    ]);
  }, [utils]);

  const deleteQueueItems = annotationApi.annotation.deleteQueueItems.useMutation({
    onSuccess: (result) => {
      setRowSelection({});
      void refreshQueues();
      host.succeeded({
        title: "Removed from queue",
        description: `${result.deleted} ${result.deleted === 1 ? "item" : "items"} removed`,
      });
    },
    onError: (error) => host.failed({ error, fallbackTitle: "Couldn't remove from queue" }),
  });

  const openTraceDrawer = useCallback(
    (row: AnnotationRow) => {
      setQuery(
        traceDetailsAddress({
          current: query,
          traceId: row.traceId,
          ...(row.occurredAtMs === void 0 ? {} : { occurredAtMs: row.occurredAtMs }),
        }),
      );
    },
    [query, setQuery],
  );

  const openRow = useCallback(
    (row: AnnotationRow) => {
      const stillWaiting = copy.rowTarget === "queueItem" && !!row.queueItemId && !row.doneAt;
      if (stillWaiting) {
        host.navigate(
          queueItemHref({
            projectSlug: project?.slug,
            queueItemId: row.queueItemId!,
            traceId: row.traceId,
          }),
        );
        return;
      }
      openTraceDrawer(row);
    },
    [copy.rowTarget, host, openTraceDrawer, project?.slug],
  );

  const addTraceIdsToDataset = useCallback(
    async (traceIds: string[]) => {
      const allowed = await datasetGate.requestEnable();
      if (!allowed) return;
      setQuery(addDatasetRecordAddress({ current: query, traceIds }));
    },
    [datasetGate, query, setQuery],
  );

  const removeFromQueue = useCallback(
    (queueItemIds: string[]) => {
      if (!project || queueItemIds.length === 0) return;
      deleteQueueItems.mutate({ projectId: project.id, queueItemIds });
    },
    [deleteQueueItems, project],
  );

  const selectedRows = useMemo(
    () => pageRows.filter((row) => rowSelection[row.id]),
    [pageRows, rowSelection],
  );
  // One trace can be queued in several queues, and a dataset record is per
  // trace, so what the dataset gets is the traces behind the picked rows.
  const selectedTraceIds = useMemo(
    () => Array.from(new Set(selectedRows.map((row) => row.traceId))),
    [selectedRows],
  );
  const selectedQueueItemIds = useMemo(
    () => selectedRows.map((row) => row.queueItemId).filter((id): id is string => id !== null),
    [selectedRows],
  );

  const exportPage = useCallback(() => {
    const { fields, rows } = annotationListExport({
      rows: pageRows,
      activeScoreTypes,
      dateColumnLabel: copy.dateColumnLabel,
    });
    downloadCsv({ fields, rows, fileName: csvFileName("Annotations") });
  }, [activeScoreTypes, copy.dateColumnLabel, pageRows]);

  const selectedCount = selectedRows.length;

  return (
    <Flex direction="column" width="full" minWidth={0} height="full" flex={1}>
      <HStack
        width="full"
        padding={6}
        paddingBottom={4}
        alignItems="flex-end"
        flexWrap="wrap"
        gap={3}
        minWidth={0}
      >
        {titleContent ?? (
          <Heading as="h1" size="lg">
            {copy.heading}
          </Heading>
        )}
        <Spacer />
        {copy.showStatusFilter && (
          <Menu.Root>
            <Menu.Trigger asChild>
              <Button variant="outline">
                Status <ChevronDown size={16} />
              </Button>
            </Menu.Trigger>
            <Menu.Content>
              <RadioGroup
                value={statusFilter}
                onValueChange={(change) => setStatusFilter(change.value ?? "")}
              >
                <VStack align="start" padding={3} gap={3}>
                  <Radio value="pending">Pending</Radio>
                  <Radio value="completed">Completed</Radio>
                  <Radio value="all">All</Radio>
                </VStack>
              </RadioGroup>
            </Menu.Content>
          </Menu.Root>
        )}
        <PeriodPicker
          period={period}
          mode={periodMode}
          // Only the queue read waits for a pick. A view that brings its own
          // rows has already applied its own range, so its label stands.
          {...(!isPageProvidedRows && !rangeIsPicked ? { label: "All time" } : {})}
          setPeriod={(startDate, endDate) =>
            setQuery(absolutePeriodAddress({ current: query, startDate, endDate }))
          }
          setRelativePeriod={(presetKey) =>
            setQuery(relativePeriodAddress({ current: query, presetKey }))
          }
          {...(isPageProvidedRows
            ? {}
            : { clearPeriod: () => setQuery(clearedPeriodAddress(query)) })}
        />
        <Button variant="ghost" onClick={onExport ?? exportPage}>
          {exportLabel ?? "Export"} <Download size={16} />
        </Button>
      </HStack>

      {isLoading ? (
        <AnnotationTableSkeleton />
      ) : pageRows.length === 0 ? (
        <NoDataInfoBlock
          title={copy.noDataTitle}
          description={copy.noDataDescription}
          docsInfo={
            <Text>
              To get started with annotations, please visit our{" "}
              <Link
                href="https://docs.langwatch.ai/features/annotations"
                isExternal
                color="orange.fg"
              >
                documentation
              </Link>
              .
            </Text>
          }
          icon={<SquarePen />}
        />
      ) : (
        <>
          {/* The one element that scrolls sideways: the header controls above
              and the pager below stay put however wide the columns get. */}
          <Box
            flex={1}
            minWidth={0}
            overflow="auto"
            paddingX={6}
            paddingBottom={4}
            data-testid="annotations-table-scroll"
          >
            {/* The card scrolls its own columns, so a table too wide for the
                page never breaks out of the border around it. */}
            <ListTable containerProps={{ overflowX: "auto" }} width="full">
              <AnnotationTable
                rows={pageRows}
                activeScoreTypes={activeScoreTypes}
                dateColumnLabel={copy.dateColumnLabel}
                selectedRowIds={new Set(selectedRows.map((row) => row.id))}
                allRowsSelected={pageRows.length > 0 && selectedRows.length === pageRows.length}
                someRowsSelected={selectedRows.length > 0 && selectedRows.length < pageRows.length}
                onToggleAll={(selected) =>
                  setRowSelection(
                    selected ? Object.fromEntries(pageRows.map((row) => [row.id, true])) : {},
                  )
                }
                onToggleRow={(rowId) =>
                  setRowSelection((current) => ({ ...current, [rowId]: !current[rowId] }))
                }
                onRowClick={openRow}
                onViewTrace={openTraceDrawer}
                onAddToDataset={(traceId) => void addTraceIdsToDataset([traceId])}
                onRemoveFromQueue={(queueItemId) => removeFromQueue([queueItemId])}
                renderAvatar={(user) => (
                  <ReviewerAvatar size="2xs" name={user.name ?? ""} image={user.image} />
                )}
                renderTraceField={({ field, value }) => (
                  <RedactedField
                    isRedacted={redaction[field].isRedacted}
                    isLoading={redaction[field].isLoading}
                    visibleTo={redaction[field].visibleTo}
                    canOpenSettings={host.hasPermission("project:view")}
                  >
                    <Tooltip content={value}>
                      <Text
                        lineClamp={2}
                        maxWidth="320px"
                        textOverflow="ellipsis"
                        wordBreak="break-word"
                      >
                        {value}
                      </Text>
                    </Tooltip>
                  </RedactedField>
                )}
              />
            </ListTable>
          </Box>
          <Pagination
            page={paging.page}
            pageSize={paging.pageSize}
            totalCount={rowCount}
            onPageChange={(page) =>
              setQuery(pageAddress({ current: query, page, pageSize: paging.pageSize }))
            }
            onPageSizeChange={(pageSize) => setQuery(pageSizeAddress({ current: query, pageSize }))}
            unitLabel="rows"
          />
        </>
      )}

      {selectedCount > 0 && (
        <SelectionActions
          host={host}
          selectedCount={selectedCount}
          selectedTraceIds={selectedTraceIds}
          selectedQueueItemIds={selectedQueueItemIds}
          {...(pageQueue ? { pageQueue } : {})}
          isRemoving={deleteQueueItems.isPending}
          onClear={() => setRowSelection({})}
          onAddToDataset={addTraceIdsToDataset}
          onRemoveFromQueue={removeFromQueue}
        />
      )}
      <PersonalFeatureGateDialog state={datasetGate.dialogState} />
    </Flex>
  );
}

/**
 * What the reviewer can do with the rows they picked: hand them to a dataset,
 * queue them for another pass, and take them out of the queue they are on.
 *
 * On a queue page the queue action MOVES rather than adds: the picker opens on
 * this queue, and leaving it out of the send is what takes the rows off it.
 */
function SelectionActions({
  host,
  selectedCount,
  selectedTraceIds,
  selectedQueueItemIds,
  pageQueue,
  isRemoving,
  onClear,
  onAddToDataset,
  onRemoveFromQueue,
}: {
  host: AnnotationHostPort;
  selectedCount: number;
  /** The traces behind the picked rows, each one once. */
  selectedTraceIds: string[];
  /** The picked rows that are queue items, which is what a queue holds. */
  selectedQueueItemIds: string[];
  pageQueue?: PageQueue;
  isRemoving: boolean;
  onClear: () => void;
  onAddToDataset: (traceIds: string[]) => Promise<void>;
  onRemoveFromQueue: (queueItemIds: string[]) => void;
}) {
  const [queueDialogOpen, setQueueDialogOpen] = useState(false);
  const project = host.project();
  const query = host.route().query;

  const onQueued = (annotatorIds: string[]) => {
    if (!pageQueue || annotatorIds.includes(pageQueue.annotatorId)) return;
    onRemoveFromQueue(selectedQueueItemIds);
  };

  return (
    <>
      <SelectionActionBar
        label={`${selectedCount} selected`}
        onClear={onClear}
        testId="annotations-selection-bar"
      >
        <Button size="xs" variant="outline" onClick={() => void onAddToDataset(selectedTraceIds)}>
          <Database size={14} />
          Add to dataset
        </Button>
        <Button size="xs" variant="outline" onClick={() => setQueueDialogOpen(true)}>
          <Inbox size={14} />
          {pageQueue ? "Move to queue" : "Add to queue"}
        </Button>
        {selectedQueueItemIds.length > 0 && (
          <Button
            size="xs"
            variant="outline"
            colorPalette="red"
            loading={isRemoving}
            onClick={() => onRemoveFromQueue(selectedQueueItemIds)}
          >
            <Trash2 size={14} />
            Remove from queue
          </Button>
        )}
      </SelectionActionBar>
      {/* Mounted only while it is open, so it opens on the membership the rows
          have now rather than on what the last send left behind. */}
      {queueDialogOpen && (
        <SendToQueueDialog
          projectId={project?.id}
          projectSlug={project?.slug}
          organizationId={host.organizationId()}
          currentUserId={host.currentUser()?.id}
          traceIds={selectedTraceIds}
          intent={pageQueue ? "move" : "add"}
          {...(pageQueue
            ? { initialAnnotators: [{ id: pageQueue.annotatorId, name: pageQueue.name }] }
            : {})}
          onQueued={onQueued}
          onClose={() => setQueueDialogOpen(false)}
          onCreateQueue={() => {
            setQueueDialogOpen(false);
            host.setQuery(queueEditorAddress({ current: query }));
          }}
          onSucceeded={(notice) => host.succeeded(notice)}
          onFailed={(error) =>
            host.failed({ error, fallbackTitle: "Couldn't add to annotation queue" })
          }
          navigate={(to) => host.navigate(to)}
        />
      )}
    </>
  );
}
