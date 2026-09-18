import {
  Badge,
  Box,
  Button,
  chakra,
  Flex,
  Heading,
  HStack,
  IconButton,
  Skeleton,
  Spacer,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  type RowSelectionState,
  useReactTable,
} from "@tanstack/react-table";
import {
  ChevronDown,
  Database,
  Download,
  Eye,
  Inbox,
  MessageCircle,
  MoreVertical,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Edit } from "react-feather";
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
import { Menu } from "../../components/ui/menu";
import { Radio, RadioGroup } from "../../components/ui/radio";
import { Tooltip } from "../../components/ui/tooltip";
import { NoDataInfoBlock } from "../NoDataInfoBlock";
import { Checkbox } from "../ui/checkbox";
import { ListTable } from "../ui/ListTable";
import { Pagination } from "../ui/Pagination";
import { RedactedField } from "../ui/RedactedField";
import { SelectionActionBar } from "../ui/SelectionActionBar";
import { toaster } from "../ui/toaster";
import { AnnotationCommentsChip } from "./AnnotationCommentsChip";
import { AnnotationSuggestionsChip } from "./AnnotationSuggestionsChip";
import UserAvatarGroup from "./AvatarGroup";
import {
  type AnnotationRow,
  type AnnotationWithUser,
  queueItemsToRows,
  suggestionExportLine,
} from "./annotationRow";

const ChakraButton = chakra("button");

const DEFAULT_PAGE_SIZE = 25;

type ScoreValue = {
  value?: string | string[] | null;
  reason?: string | null;
};

/** A score type the project still collects, and therefore still shows. */
type ActiveScoreType = { id: string; name: string };

/**
 * Whole-cell checkbox hit target, kept separate from the row's own click so
 * picking rows never navigates to the queue item or the trace. Mirrors the
 * trace table's select cells.
 */
function SelectCheckbox({
  ariaLabel,
  checked,
  onToggle,
}: {
  ariaLabel: string;
  checked: boolean | "indeterminate";
  onToggle: () => void;
}) {
  return (
    <ChakraButton
      type="button"
      // `aria-checked` is a checkbox state, and the `button` role drops it, so
      // the wrapper takes the checkbox role. A native <button> still gives it
      // click and Space/Enter handling for free.
      role="checkbox"
      aria-label={ariaLabel}
      aria-checked={
        checked === true ? "true" : checked === false ? "false" : "mixed"
      }
      display="flex"
      alignItems="center"
      justifyContent="center"
      minHeight="32px"
      paddingX={2}
      bg="transparent"
      border="none"
      cursor="pointer"
      onClick={(e: React.MouseEvent) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      {/* The Chakra control is decoration: it renders its own hidden input,
          which would otherwise sit inside the button as a second, inert
          checkbox node. */}
      <Box pointerEvents="none" display="inline-flex" aria-hidden="true">
        <Checkbox size="sm" checked={checked} />
      </Box>
    </ChakraButton>
  );
}

/** Page number and size, kept in the URL so a list survives a reload. */
function useListPaging() {
  const router = useRouter();
  const pageOffset = parseInt(router.query.pageOffset as string) || 0;
  const pageSize =
    parseInt(router.query.pageSize as string) || DEFAULT_PAGE_SIZE;
  const page = Math.floor(pageOffset / pageSize) + 1;

  const push = useCallback(
    (next: { pageOffset: number; pageSize: number }) => {
      const { pageOffset: _offset, pageSize: _size, ...rest } = router.query;
      void router.push(
        {
          pathname: router.pathname,
          query: {
            ...rest,
            ...(next.pageOffset !== 0
              ? { pageOffset: String(next.pageOffset) }
              : {}),
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

const formatRowDate = (date: Date | null): string =>
  date ? date.toLocaleDateString() : "-";

const scoreValuesFor = (
  annotations: AnnotationWithUser[],
  scoreTypeId: string,
): { annotationId: string; value: string[]; reason?: string | null }[] =>
  annotations.flatMap((annotation) => {
    const scores = annotation.scoreOptions as Record<string, ScoreValue> | null;
    const score = scores?.[scoreTypeId];
    if (!score?.value) return [];
    const value = Array.isArray(score.value) ? score.value : [score.value];
    if (value.length === 0) return [];
    return [
      { annotationId: annotation.id, value, reason: score.reason ?? null },
    ];
  });

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
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});

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

  const { assignedQueueItems, queuesLoading, totalCount } = useAnnotationQueues(
    {
      selectedAnnotations: statusFilter,
      queueId,
      showQueueAndUser,
      ...queuedRange,
      enabled: !isPageProvidedRows,
    },
  );

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
  }, [
    statusFilter,
    queueId,
    paging.pageOffset,
    paging.pageSize,
    queuedRangeKey,
  ]);

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
        ...(row.occurredAtMs !== undefined
          ? { t: String(row.occurredAtMs) }
          : {}),
      });
    },
    [openDrawer],
  );

  const openRow = useCallback(
    (row: AnnotationRow) => {
      const stillWaiting =
        rowTarget === "queueItem" && !!row.queueItemId && !row.doneAt;
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

  const columnHelper = useMemo(() => createColumnHelper<AnnotationRow>(), []);

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: "select",
        header: ({ table }) => {
          if (table.getRowModel().rows.length === 0) return null;
          const allSelected = table.getIsAllPageRowsSelected();
          const someSelected = table.getIsSomePageRowsSelected();
          return (
            <SelectCheckbox
              ariaLabel="Select all on this page"
              checked={
                allSelected ? true : someSelected ? "indeterminate" : false
              }
              onToggle={() => table.toggleAllPageRowsSelected(!allSelected)}
            />
          );
        },
        cell: ({ row }) => (
          <SelectCheckbox
            ariaLabel={`Select trace ${row.original.traceId}`}
            checked={row.getIsSelected()}
            onToggle={() => row.toggleSelected()}
          />
        ),
      }),
      columnHelper.display({
        id: "queuedBy",
        header: "",
        cell: ({ row }) => (
          <Tooltip
            content={
              <VStack align="start" gap={0}>
                {row.original.createdByUser && (
                  <Text marginBottom={2}>
                    Queued by {row.original.createdByUser.name}
                  </Text>
                )}
                {row.original.annotations.length > 0 && (
                  <>
                    <Text>Annotated by:</Text>
                    {annotatorNames(row.original.annotations).map((name) => (
                      <Text key={name}>{name}</Text>
                    ))}
                  </>
                )}
              </VStack>
            }
          >
            <HStack>
              <UserAvatarGroup
                createdByUser={row.original.createdByUser}
                annotations={row.original.annotations}
              />
            </HStack>
          </Tooltip>
        ),
      }),
      columnHelper.display({
        id: "date",
        header: dateColumnLabel,
        cell: ({ row }) => (
          <Text whiteSpace="nowrap">{formatRowDate(row.original.date)}</Text>
        ),
      }),
      columnHelper.display({
        id: "input",
        header: "Input",
        cell: ({ row }) => (
          <RedactedField field="input">
            <Tooltip content={row.original.trace?.input?.value ?? "<empty>"}>
              <Text
                lineClamp={2}
                maxWidth="320px"
                textOverflow="ellipsis"
                wordBreak="break-word"
              >
                {row.original.trace?.input?.value ?? "<empty>"}
              </Text>
            </Tooltip>
          </RedactedField>
        ),
      }),
      columnHelper.display({
        id: "output",
        header: "Output",
        cell: ({ row }) => (
          <RedactedField field="output">
            <Tooltip content={row.original.trace?.output?.value ?? "<empty>"}>
              <Text
                lineClamp={2}
                maxWidth="320px"
                textOverflow="ellipsis"
                wordBreak="break-word"
              >
                {row.original.trace?.output?.value ?? "<empty>"}
              </Text>
            </Tooltip>
          </RedactedField>
        ),
      }),
      columnHelper.display({
        id: "comments",
        header: "Comments",
        cell: ({ row }) => (
          <AnnotationCommentsChip
            annotations={row.original.annotations}
            traceId={row.original.traceId}
          />
        ),
      }),
      columnHelper.display({
        id: "suggestions",
        header: "Suggestions",
        cell: ({ row }) => (
          <AnnotationSuggestionsChip
            annotations={row.original.annotations}
            traceId={row.original.traceId}
          />
        ),
      }),
      ...activeScoreTypes.map((scoreType) =>
        columnHelper.display({
          id: `score-${scoreType.id}`,
          header: scoreType.name,
          cell: ({ row }) => (
            <VStack align="start" gap={2}>
              {scoreValuesFor(row.original.annotations, scoreType.id).map(
                (score) => (
                  <HStack key={score.annotationId} gap={1} wrap="wrap">
                    {score.value.map((value) => (
                      <Badge key={value}>{value}</Badge>
                    ))}
                    {score.reason && (
                      <Tooltip content={score.reason}>
                        <MessageCircle size={14} />
                      </Tooltip>
                    )}
                  </HStack>
                ),
              )}
            </VStack>
          ),
        }),
      ),
      columnHelper.display({
        id: "actions",
        header: "",
        cell: ({ row }) => (
          <Menu.Root>
            <Menu.Trigger asChild>
              <IconButton
                aria-label={`Actions for trace ${row.original.traceId}`}
                variant="ghost"
                size="sm"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical size={16} />
              </IconButton>
            </Menu.Trigger>
            <Menu.Content>
              <Menu.Item
                value="view-trace"
                onClick={(e) => {
                  e.stopPropagation();
                  openTraceDrawer(row.original);
                }}
              >
                <Eye size={14} /> View trace
              </Menu.Item>
              <Menu.Item
                value="add-to-dataset"
                onClick={(e) => {
                  e.stopPropagation();
                  void addTraceIdsToDataset([row.original.traceId]);
                }}
              >
                <Database size={14} /> Add to dataset
              </Menu.Item>
              {row.original.queueItemId && (
                <Menu.Item
                  value="remove-from-queue"
                  color="red.500"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFromQueue([row.original.queueItemId!]);
                  }}
                >
                  <Trash2 size={14} /> Remove from queue
                </Menu.Item>
              )}
            </Menu.Content>
          </Menu.Root>
        ),
      }),
    ],
    [
      activeScoreTypes,
      addTraceIdsToDataset,
      columnHelper,
      dateColumnLabel,
      openTraceDrawer,
      removeFromQueue,
    ],
  );

  const table = useReactTable({
    data: pageRows,
    columns,
    state: { rowSelection },
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
  });

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
        .map((annotation) =>
          suggestionExportLine({ annotation, traceId: row.traceId }),
        )
        .filter(Boolean)
        .join("\n"),
      ...activeScoreTypes.map((scoreType) =>
        scoreValuesFor(row.annotations, scoreType.id)
          .map((score) =>
            score.reason
              ? `${score.value.join(", ")} (${score.reason})`
              : score.value.join(", "),
          )
          .join("\n"),
      ),
      annotatorNames(row.annotations).join(", "),
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
        <TableSkeleton />
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
              <Table.Header>
                {table.getHeaderGroups().map((headerGroup) => (
                  <Table.Row key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <Table.ColumnHeader
                        key={header.id}
                        width={
                          header.id === "select"
                            ? "1px"
                            : header.id === "actions"
                              ? "48px"
                              : undefined
                        }
                        paddingX={header.id === "select" ? 0 : undefined}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                      </Table.ColumnHeader>
                    ))}
                  </Table.Row>
                ))}
              </Table.Header>
              <Table.Body>
                {table.getRowModel().rows.map((row) => (
                  // Armed, the row can be handed to Langy. The resource a queue
                  // item IS about is its trace, and that is the chip id the
                  // trace drawer this row opens derives.
                  <LangyContextTarget
                    key={row.id}
                    target={traceContextChip(row.original.traceId)}
                  >
                    <Table.Row
                      cursor="pointer"
                      _hover={{ bg: "bg.emphasized" }}
                      backgroundColor={
                        row.original.doneAt ? "bg.subtle" : "bg.panel"
                      }
                      onClick={() => openRow(row.original)}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <Table.Cell
                          key={cell.id}
                          paddingX={cell.column.id === "select" ? 0 : undefined}
                          verticalAlign="top"
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </Table.Cell>
                      ))}
                    </Table.Row>
                  </LangyContextTarget>
                ))}
              </Table.Body>
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
        <Button
          size="xs"
          variant="outline"
          onClick={() => setQueueDialogOpen(true)}
        >
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
            pageQueue
              ? [{ id: pageQueue.annotatorId, name: pageQueue.name }]
              : undefined
          }
          onQueued={onQueued}
        />
      )}
    </>
  );
}

/** Everyone who left an annotation on the row, each named once. */
function annotatorNames(annotations: AnnotationWithUser[]): string[] {
  return Array.from(
    new Set(
      annotations
        .map((annotation) => annotation.user?.name)
        .filter((name): name is string => !!name),
    ),
  );
}

function TableSkeleton() {
  return (
    <Box flex={1} minWidth={0} overflow="auto" paddingX={6}>
      <Table.Root variant="line" width="full">
        <Table.Header>
          <Table.Row>
            {Array.from({ length: 6 }).map((_, i) => (
              <Table.ColumnHeader key={i}>
                <Skeleton height="20px" width="100px" />
              </Table.ColumnHeader>
            ))}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {Array.from({ length: 5 }).map((_, i) => (
            <Table.Row key={i}>
              {Array.from({ length: 6 }).map((_, j) => (
                <Table.Cell key={j}>
                  <Skeleton
                    height="20px"
                    width={j === 2 || j === 3 ? "200px" : "100px"}
                  />
                </Table.Cell>
              ))}
            </Table.Row>
          ))}
        </Table.Body>
      </Table.Root>
    </Box>
  );
}
