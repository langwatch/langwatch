import {
  Box,
  Button,
  Flex,
  Heading,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { ChevronDown, Database, Download, Inbox, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Edit } from "react-feather";
import {
  AnnotationTable,
  AnnotationTableSkeleton,
  type AnnotationRow,
  annotationScores,
  queueItemsToRows,
  suggestionExportLine,
} from "@langwatch/annotation-web";
import { PersonalFeatureGateDialog } from "~/components/me/PersonalFeatureGateDialog";
import { usePersonalFeatureGate } from "~/components/me/usePersonalFeatureGate";
import { PeriodSelector, usePeriodSelector } from "~/components/PeriodSelector";
import { showErrorToast } from "~/features/errors";
import { LangyContextTarget } from "~/features/langy/components/LangyContextTarget";
import { traceContextChip } from "~/features/langy/logic/langyContextChips";
import { AddToAnnotationQueueDialog } from "~/features/traces-v2/components/AddToAnnotationQueueDialog";
import { useAnnotationQueues } from "~/hooks/useAnnotationQueues";
import { useDrawer } from "~/hooks/useDrawer";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";
import { csvFileName, downloadCsv } from "~/utils/downloadCsv";
import { Link } from "../../components/ui/link";
import { Menu } from "@langwatch/design-system/menu";
import { Radio, RadioGroup } from "@langwatch/design-system/radio";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { NoDataInfoBlock } from "../NoDataInfoBlock";
import { ListTable } from "../ui/ListTable";
import { Pagination } from "../ui/Pagination";
import { RedactedField } from "../ui/RedactedField";
import { SelectionActionBar } from "../ui/SelectionActionBar";
import { toaster } from "../ui/toaster";
import { RandomColorAvatar } from "../RandomColorAvatar";

const DEFAULT_PAGE_SIZE = 25;

/** A score type the project still collects, and therefore still shows. */
type ActiveScoreType = { id: string; name: string };

/** Page number and size, kept in the URL so a list survives a reload. */
function useListPaging() {
  const router = useRouter();
  const pageOffset = parseInt(router.query.pageOffset as string) || 0;
  const pageSize = parseInt(router.query.pageSize as string) || DEFAULT_PAGE_SIZE;
  const page = Math.floor(pageOffset / pageSize) + 1;

  const push = useCallback(
    (next: { pageOffset: number; pageSize: number }) => {
      const { pageOffset: _offset, pageSize: _size, ...rest } = router.query;
      void router.push(
        {
          pathname: router.pathname,
          query: {
            ...rest,
            ...(next.pageOffset !== 0 ? { pageOffset: String(next.pageOffset) } : {}),
            ...(next.pageSize !== DEFAULT_PAGE_SIZE
              ? { pageSize: String(next.pageSize) }
              : {}),
          },
        },
        undefined,
        { shallow: true },
      );
    },
    [router],
  );

  return {
    page,
    pageOffset,
    pageSize,
    setPage: useCallback(
      (nextPage: number) =>
        push({ pageOffset: Math.max(0, nextPage - 1) * pageSize, pageSize }),
      [push, pageSize],
    ),
    setPageSize: useCallback(
      (nextSize: number) => push({ pageOffset: 0, pageSize: nextSize }),
      [push],
    ),
  };
}

export type AnnotationsTableProps = {
  /** Page title. Ignored when `titleContent` is given. */
  heading?: string;
  /** Richer title area, for the queue page's name plus its members. */
  titleContent?: React.ReactNode;
  noDataTitle?: string;
  noDataDescription?: string;
  /** Column heading for a row's date, and the same label in the export. */
  dateColumnLabel: string;
  /** Pending / Completed / All. Off where a row is not queued work. */
  showStatusFilter: boolean;
  /** Where a row that is still waiting takes the reviewer. */
  rowTarget: "queueItem" | "trace";
  /** Queue read: restrict to one queue. */
  queueId?: string;
  /**
   * The list this page is, named the way the queue picker names participants
   * ("queue-<id>" for a named queue, "user-<id>" for a reviewer's own inbox).
   * A page that is a queue moves its selection to another queue rather than
   * only adding it to one.
   */
  pageQueue?: { annotatorId: string; name: string };
  /** Queue read: include the queues the caller belongs to. */
  showQueueAndUser?: boolean;
  /**
   * Rows supplied by the page instead of read from the queues. The whole list:
   * the table pages through it.
   */
  rows?: AnnotationRow[];
  rowsLoading?: boolean;
  /** Replaces "export what is on screen" with the page's own export. */
  exportLabel?: string;
  onExport?: () => void;
};

export const AnnotationsTable = ({
  heading,
  titleContent,
  noDataTitle,
  noDataDescription,
  dateColumnLabel,
  showStatusFilter,
  rowTarget,
  queueId,
  pageQueue,
  showQueueAndUser,
  rows: providedRows,
  rowsLoading,
  exportLabel,
  onExport,
}: AnnotationsTableProps) => {
  const router = useRouter();
  const { project } = useOrganizationTeamProject();
  const { openDrawer } = useDrawer();
  const utils = api.useUtils();

  const paging = useListPaging();
  const {
    period: { startDate, endDate },
    mode: periodMode,
    isDefault: periodIsDefault,
    setPeriod,
    setRelativePeriod,
  } = usePeriodSelector();

  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});

  const isPageProvidedRows = providedRows !== undefined;

  // A queue is a list of work still to do, and the sidebar badge counts all of
  // it, so a default window that quietly dropped older items would leave the
  // badge and the list disagreeing. The range narrows the read only once the
  // reviewer has picked one; until then the control says so and reads "All
  // time".
  const rangeIsPicked = !periodIsDefault;
  const queuedRange = rangeIsPicked ? { startDate, endDate } : {};
  // The range as a value rather than two Date objects, so effects keyed on it
  // fire when the window changes and not merely when it is re-derived.
  const queuedRangeKey = rangeIsPicked
    ? `${startDate.getTime()}-${endDate.getTime()}`
    : "all";

  const clearRange = useCallback(() => {
    const {
      period: _period,
      startDate: _startDate,
      endDate: _endDate,
      ...rest
    } = router.query;
    void router.push({ pathname: router.pathname, query: rest }, undefined, {
      shallow: true,
    });
  }, [router]);

  const { assignedQueueItems, queuesLoading, totalCount } = useAnnotationQueues({
    selectedAnnotations: statusFilter,
    queueId,
    showQueueAndUser,
    ...queuedRange,
    enabled: !isPageProvidedRows,
  });

  const scoreTypes = api.annotationScore.getAll.useQuery(
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

  // A page that brings its own rows brings all of them, so the pager slices
  // them here; the queue read is already paged by the server.
  const allRows: AnnotationRow[] = useMemo(
    () => providedRows ?? queueItemsToRows(assignedQueueItems ?? []),
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

  const datasetGate = usePersonalFeatureGate("datasets");

  const refreshQueues = useCallback(async () => {
    await Promise.all([
      utils.annotation.getOptimizedAnnotationQueues.invalidate(),
      utils.annotation.getPendingItemsCount.invalidate(),
      utils.annotation.getAssignedItemsCount.invalidate(),
      utils.annotation.getQueueItemsCounts.invalidate(),
    ]);
  }, [utils]);

  const deleteQueueItems = api.annotation.deleteQueueItems.useMutation({
    onSuccess: (result) => {
      setRowSelection({});
      void refreshQueues();
      toaster.create({
        title: "Removed from queue",
        description: `${result.deleted} ${
          result.deleted === 1 ? "item" : "items"
        } removed`,
        type: "success",
      });
    },
    onError: (error) =>
      showErrorToast({ error, fallbackTitle: "Couldn't remove from queue" }),
  });

  const openTraceDrawer = useCallback(
    (row: AnnotationRow) => {
      openDrawer("traceV2Details", {
        traceId: row.traceId,
        ...(row.occurredAtMs !== undefined ? { t: String(row.occurredAtMs) } : {}),
      });
    },
    [openDrawer],
  );

  const openRow = useCallback(
    (row: AnnotationRow) => {
      const stillWaiting = rowTarget === "queueItem" && !!row.queueItemId && !row.doneAt;
      if (stillWaiting) {
        void router.push(
          `/${project?.slug}/annotations/my-queue?queue-item=${row.queueItemId}&trace=${row.traceId}`,
        );
        return;
      }
      openTraceDrawer(row);
    },
    [openTraceDrawer, project?.slug, router, rowTarget],
  );

  const addTraceIdsToDataset = useCallback(
    async (traceIds: string[]) => {
      const allowed = await datasetGate.requestEnable();
      if (!allowed) return;
      openDrawer("addDatasetRecord", { selectedTraceIds: traceIds });
    },
    [datasetGate, openDrawer],
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
    () =>
      selectedRows
        .map((row) => row.queueItemId)
        .filter((id): id is string => id !== null),
    [selectedRows],
  );

  const exportPage = useCallback(() => {
    const fields = [
      dateColumnLabel,
      "Status",
      "Queued by",
      "Trace ID",
      "Input",
      "Output",
      "Comments",
      "Suggestions",
      ...activeScoreTypes.map((scoreType) => scoreType.name),
      "Annotators",
    ];
    const data = pageRows.map((row) => [
      row.date ? row.date.toISOString() : "",
      row.doneAt ? "Completed" : "Pending",
      row.createdByUser?.name ?? "",
      row.traceId,
      row.trace?.input?.value ?? "",
      row.trace?.output?.value ?? "",
      row.annotations
        .map((annotation) => annotation.comment)
        .filter(Boolean)
        .join("\n"),
      row.annotations
        .map((annotation) => suggestionExportLine({ annotation, traceId: row.traceId }))
        .filter(Boolean)
        .join("\n"),
      ...activeScoreTypes.map((scoreType) =>
        row.annotations
          .flatMap((annotation) => {
            const score = annotationScores({ annotation }).find(
              (answer) => answer.name === scoreType.id,
            );
            if (!score) return [];
            const value = score.values.join(", ");
            return [score.reason ? `${value} (${score.reason})` : value];
          })
          .join("\n"),
      ),
      Array.from(
        new Set(
          row.annotations
            .map((annotation) => annotation.user?.name)
            .filter((name): name is string => !!name),
        ),
      ).join(", "),
    ]);

    downloadCsv({ fields, rows: data, fileName: csvFileName("Annotations") });
  }, [activeScoreTypes, dateColumnLabel, pageRows]);

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
            {heading}
          </Heading>
        )}
        <Spacer />
        {showStatusFilter && (
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
        <PeriodSelector
          period={{ startDate, endDate }}
          mode={periodMode}
          // Only the queue read waits for a pick. A page that brings its own
          // rows has already applied its own range, so its label stands.
          label={!isPageProvidedRows && !rangeIsPicked ? "All time" : undefined}
          setPeriod={setPeriod}
          setRelativePeriod={setRelativePeriod}
          clearPeriod={isPageProvidedRows ? undefined : clearRange}
        />
        <Button variant="ghost" onClick={onExport ?? exportPage}>
          {exportLabel ?? "Export"} <Download size={16} />
        </Button>
      </HStack>

      {isLoading ? (
        <AnnotationTableSkeleton />
      ) : pageRows.length === 0 ? (
        <NoDataInfoBlock
          title={noDataTitle ?? "No annotations yet"}
          description={
            noDataDescription ??
            "Annotate your messages to add more context and improve your analysis."
          }
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
          icon={<Edit />}
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
                dateColumnLabel={dateColumnLabel}
                selectedRowIds={new Set(selectedRows.map((row) => row.id))}
                allRowsSelected={
                  pageRows.length > 0 && selectedRows.length === pageRows.length
                }
                someRowsSelected={
                  selectedRows.length > 0 && selectedRows.length < pageRows.length
                }
                onToggleAll={(selected) =>
                  setRowSelection(
                    selected
                      ? Object.fromEntries(pageRows.map((row) => [row.id, true]))
                      : {},
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
                  <RandomColorAvatar
                    size="2xs"
                    name={user.name ?? ""}
                    image={user.image}
                  />
                )}
                renderTraceField={({ field, value }) => (
                  <RedactedField field={field}>
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
                renderRowContext={(row, children) => (
                  <LangyContextTarget key={row.id} target={traceContextChip(row.traceId)}>
                    {children}
                  </LangyContextTarget>
                )}
              />
            </ListTable>
          </Box>
          <Pagination
            page={paging.page}
            pageSize={paging.pageSize}
            totalCount={rowCount}
            onPageChange={paging.setPage}
            onPageSizeChange={paging.setPageSize}
            unitLabel="rows"
          />
        </>
      )}

      {selectedCount > 0 && (
        <SelectionActions
          selectedCount={selectedCount}
          selectedTraceIds={selectedTraceIds}
          selectedQueueItemIds={selectedQueueItemIds}
          pageQueue={pageQueue}
          isRemoving={deleteQueueItems.isPending}
          onClear={() => setRowSelection({})}
          onAddToDataset={addTraceIdsToDataset}
          onRemoveFromQueue={removeFromQueue}
        />
      )}
      <PersonalFeatureGateDialog state={datasetGate.dialogState} />
    </Flex>
  );
};

/**
 * What the reviewer can do with the rows they picked: hand them to a dataset,
 * queue them for another pass, and take them out of the queue they are on.
 *
 * On a queue page the queue action moves rather than adds: the picker opens on
 * this queue, and leaving it out of the send is what takes the rows off it.
 */
function SelectionActions({
  selectedCount,
  selectedTraceIds,
  selectedQueueItemIds,
  pageQueue,
  isRemoving,
  onClear,
  onAddToDataset,
  onRemoveFromQueue,
}: {
  selectedCount: number;
  /** The traces behind the picked rows, each one once. */
  selectedTraceIds: string[];
  /** The picked rows that are queue items, which is what a queue holds. */
  selectedQueueItemIds: string[];
  pageQueue?: AnnotationsTableProps["pageQueue"];
  isRemoving: boolean;
  onClear: () => void;
  onAddToDataset: (traceIds: string[]) => Promise<void>;
  onRemoveFromQueue: (queueItemIds: string[]) => void;
}) {
  const [queueDialogOpen, setQueueDialogOpen] = useState(false);

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
        <Button
          size="xs"
          variant="outline"
          onClick={() => void onAddToDataset(selectedTraceIds)}
        >
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
        <AddToAnnotationQueueDialog
          open
          onClose={() => setQueueDialogOpen(false)}
          traceIds={selectedTraceIds}
          intent={pageQueue ? "move" : "add"}
          initialAnnotators={
            pageQueue ? [{ id: pageQueue.annotatorId, name: pageQueue.name }] : undefined
          }
          onQueued={onQueued}
        />
      )}
    </>
  );
}
