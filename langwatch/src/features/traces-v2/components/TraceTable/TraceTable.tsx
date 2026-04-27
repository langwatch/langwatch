import {
  Box,
  Button,
  EmptyState,
  Flex,
  Skeleton,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  type SortingState,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { Search } from "lucide-react";
import type React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useDrawer, useDrawerParams } from "~/hooks/useDrawer";
import { useDensityTokens } from "../../hooks/useDensityTokens";
import { useOpenTraceDrawer } from "../../hooks/useOpenTraceDrawer";
import { useTraceList } from "../../hooks/useTraceList";
import { useFilterStore } from "../../stores/filterStore";
import {
  type LensConfig,
  groupByForGrouping,
  rowKindForGrouping,
  useViewStore,
} from "../../stores/viewStore";
import type { TraceListItem } from "../../types/trace";
import { RefreshProgressBar } from "../TracesPage/RefreshProgressBar";
import {
  buildConversationColumns,
  buildGroupColumns,
  buildTraceColumns,
} from "./columns";
import { type ConversationGroup, groupTracesByConversation } from "./conversationGroups";
import { NewTracesScrollUpIndicator } from "./NewTracesScrollUpIndicator";
import { Pagination } from "./Pagination";
import {
  RegistryRow,
  type Registry,
  type TraceGroup,
  buildGroups,
  conversationRegistry,
  expandTraceColumns,
  groupRegistry,
  traceRegistry,
} from "./registry";
import { traceCells } from "./registry/cells/trace";
import { useUIStore } from "../../stores/uiStore";
import { Td, Tr } from "./TablePrimitives";
import { TraceTableShell, type ColumnMeta } from "./TraceTableShell";

export const TraceTable: React.FC = () => {
  const { data: traces, totalHits, isLoading, newIds } = useTraceList();
  const activeLens = useViewStore((s) =>
    s.allLenses.find((l) => l.id === s.activeLensId) ?? s.allLenses[0]!,
  );

  if (isLoading) {
    return <TraceTableSkeleton />;
  }

  if (traces.length === 0) {
    return <EmptyFilterState />;
  }

  const rowKind = rowKindForGrouping(activeLens.grouping);

  return (
    <TraceTableLayout totalHits={totalHits}>
      {rowKind === "conversation" && (
        <ConversationLensBody traces={traces} lens={activeLens} />
      )}
      {rowKind === "group" && (
        <GroupLensBody traces={traces} lens={activeLens} />
      )}
      {rowKind === "trace" && (
        <TraceLensBody traces={traces} lens={activeLens} newIds={newIds} />
      )}
    </TraceTableLayout>
  );
};

const TraceLensBody: React.FC<{
  traces: TraceListItem[];
  lens: LensConfig;
  newIds: Set<string>;
}> = ({ traces, lens, newIds }) => {
  const { closeDrawer, currentDrawer } = useDrawer();
  const params = useDrawerParams();
  const openTraceDrawer = useOpenTraceDrawer();
  const density = useUIStore((s) => s.density);
  const selectedTraceId =
    currentDrawer === "traceV2Details" ? (params.traceId ?? null) : null;

  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [expandedTraceId, setExpandedTraceId] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([
    { id: lens.sort.columnId, desc: lens.sort.direction === "desc" },
  ]);

  const expanded = useMemo(
    () =>
      density === "comfortable"
        ? expandTraceColumns(lens.columns, traces, traceCells)
        : null,
    [density, lens.columns, traces],
  );

  const columns = useMemo(() => {
    if (expanded) return expanded.map((e) => e.columnDef);
    return buildTraceColumns(lens.columns);
  }, [expanded, lens.columns]);

  const registry: Registry<TraceListItem> = useMemo(() => {
    if (!expanded) return traceRegistry;
    const dynamicCells = Object.fromEntries(
      expanded.map((e) => [e.id, e.cellDef]),
    );
    return {
      rowKind: "trace",
      cells: { ...traceRegistry.cells, ...dynamicCells },
      addons: traceRegistry.addons,
    };
  }, [expanded]);

  const minWidth = useMemo(() => {
    if (!expanded) return "1500px";
    const total = expanded.reduce(
      (sum, e) => sum + ((e.columnDef as { minSize?: number }).minSize ?? 100),
      0,
    );
    return `${Math.max(total, 1500)}px`;
  }, [expanded]);

  const toggleTrace = useCallback(
    (trace: TraceListItem) => {
      if (selectedTraceId === trace.traceId) {
        closeDrawer();
      } else {
        openTraceDrawer(trace);
      }
    },
    [selectedTraceId, closeDrawer, openTraceDrawer],
  );

  const togglePeek = useCallback(
    (traceId: string) =>
      setExpandedTraceId((prev) => (prev === traceId ? null : traceId)),
    [],
  );

  const table = useReactTable({
    data: traces,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualSorting: true,
    getRowId: (row) => row.traceId,
  });

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocusedIndex((i) => Math.min(i + 1, traces.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocusedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && focusedIndex >= 0 && traces[focusedIndex]) {
        toggleTrace(traces[focusedIndex]);
      } else if (e.key === "Escape") {
        closeDrawer();
      } else if (e.key === "p" && focusedIndex >= 0 && traces[focusedIndex]) {
        togglePeek(traces[focusedIndex].traceId);
      }
    },
    [traces, focusedIndex, toggleTrace, togglePeek, closeDrawer],
  );

  const rows = table.getRowModel().rows;

  return (
    <Box tabIndex={0} onKeyDown={handleKeyDown} outline="none" height="full">
      <TraceTableShell table={table} minWidth={minWidth}>
        {rows.map((row, index) => (
          <RegistryRow
            key={row.id}
            tanstackRow={row}
            registry={registry}
            addons={lens.addons}
            status={row.original.status}
            hoverScope="unified"
            isSelected={row.original.traceId === selectedTraceId}
            isFocused={index === focusedIndex}
            isExpanded={row.original.traceId === expandedTraceId}
            isNew={newIds.has(row.original.traceId)}
            rowDomId={row.original.traceId}
            onSelect={() => toggleTrace(row.original)}
            onTogglePeek={() => togglePeek(row.original.traceId)}
          />
        ))}
      </TraceTableShell>
    </Box>
  );
};

const ConversationLensBody: React.FC<{
  traces: TraceListItem[];
  lens: LensConfig;
}> = ({ traces, lens }) => {
  const groups = useMemo(() => groupTracesByConversation(traces), [traces]);
  const [sorting, setSorting] = useState<SortingState>([
    { id: lens.sort.columnId, desc: lens.sort.direction === "desc" },
  ]);
  const columns = useMemo(
    () => buildConversationColumns(lens.columns),
    [lens.columns],
  );
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const table = useReactTable({
    data: groups,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    manualSorting: true,
    getRowId: (row) => row.conversationId,
  });

  if (groups.length === 0) {
    return (
      <Flex align="center" justify="center" padding={8} direction="column" gap={2}>
        <Text color="fg.muted" textStyle="sm">
          No conversations found.
        </Text>
        <Text textStyle="xs" color="fg.subtle">
          Conversations appear when traces include a conversation ID.
        </Text>
      </Flex>
    );
  }

  return (
    <TraceTableShell table={table} minWidth="880px">
      {table.getRowModel().rows.map((row) => {
        const isExpanded = expandedKey === row.original.conversationId;
        return (
          <RegistryRow<ConversationGroup>
            key={row.id}
            tanstackRow={row}
            registry={conversationRegistry}
            addons={lens.addons}
            status={row.original.worstStatus}
            hoverScope="split"
            isExpanded={isExpanded}
            onToggleExpand={() =>
              setExpandedKey((prev) =>
                prev === row.original.conversationId
                  ? null
                  : row.original.conversationId,
              )
            }
          />
        );
      })}
    </TraceTableShell>
  );
};

const GroupLensBody: React.FC<{
  traces: TraceListItem[];
  lens: LensConfig;
}> = ({ traces, lens }) => {
  const groupBy = groupByForGrouping(lens.grouping);
  const groups = useMemo(
    () => (groupBy ? buildGroups(traces, groupBy) : []),
    [traces, groupBy],
  );
  const [openKeys, setOpenKeys] = useState<Set<string>>(() => new Set());
  const [sorting, setSorting] = useState<SortingState>([
    { id: lens.sort.columnId, desc: lens.sort.direction === "desc" },
  ]);
  const columns = useMemo(
    () => (groupBy ? buildGroupColumns(lens.columns, groupBy) : []),
    [lens.columns, groupBy],
  );

  const table = useReactTable({
    data: groups,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.key,
  });

  if (!groupBy || groups.length === 0) {
    return (
      <Flex align="center" justify="center" padding={8} direction="column" gap={2}>
        <Text color="fg.muted" textStyle="sm">
          No traces to group.
        </Text>
      </Flex>
    );
  }

  return (
    <TraceTableShell table={table} minWidth="880px">
      {table.getRowModel().rows.map((row) => {
        const isExpanded = openKeys.has(row.original.key);
        return (
          <RegistryRow<TraceGroup>
            key={row.id}
            tanstackRow={row}
            registry={groupRegistry}
            addons={lens.addons}
            status={row.original.worstStatus}
            hoverScope="split"
            isExpanded={isExpanded}
            onToggleExpand={() =>
              setOpenKeys((prev) => {
                const next = new Set(prev);
                if (next.has(row.original.key)) {
                  next.delete(row.original.key);
                } else {
                  next.add(row.original.key);
                }
                return next;
              })
            }
          />
        );
      })}
    </TraceTableShell>
  );
};

const TraceTableLayout: React.FC<{
  totalHits: number;
  children: React.ReactNode;
}> = ({ totalHits, children }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <Flex direction="column" height="full" position="relative">
      <Box ref={scrollRef} flex={1} overflow="auto">
        {children}
      </Box>
      <RefreshProgressBar />
      <NewTracesScrollUpIndicator scrollRef={scrollRef} />
      <Pagination totalHits={totalHits} />
    </Flex>
  );
};

const TableWatermark: React.FC = () => (
  <Box
    position="absolute"
    inset={0}
    display="flex"
    alignItems="center"
    justifyContent="center"
    pointerEvents="none"
    aria-hidden="true"
  >
    <Box opacity={0.035} color="fg">
      <svg
        width="120"
        height="164"
        viewBox="0 0 38 52"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M0 12.383V41.035C0 41.392 0.190002 41.723 0.500002 41.901L17.095 51.481C17.25 51.571 17.422 51.616 17.595 51.616C17.768 51.616 17.94 51.571 18.095 51.481L37.279 40.409C37.589 40.23 37.779 39.9 37.779 39.543V10.887C37.779 10.53 37.589 10.199 37.279 10.021L31.168 6.49498C31.014 6.40598 30.841 6.36098 30.669 6.36098C30.496 6.36098 30.323 6.40498 30.169 6.49498L27.295 8.15398V4.83698C27.295 4.47998 27.105 4.14898 26.795 3.97098L20.684 0.441982C20.529 0.352982 20.357 0.307983 20.184 0.307983C20.011 0.307983 19.839 0.352982 19.684 0.441982L13.781 3.85098C13.471 4.02998 13.281 4.35998 13.281 4.71698V12.157L12.921 12.365V11.872C12.921 11.515 12.731 11.185 12.421 11.006L7.405 8.10698C7.25 8.01798 7.077 7.97298 6.905 7.97298C6.733 7.97298 6.56 8.01798 6.405 8.10698L0.501001 11.517C0.191001 11.695 0 12.025 0 12.383Z"
          fill="currentColor"
        />
        <path
          d="M0 12.383V41.035C0 41.392 0.190002 41.723 0.500002 41.901L17.095 51.481C17.25 51.571 17.422 51.616 17.595 51.616C17.768 51.616 17.94 51.571 18.095 51.481L37.279 40.409C37.589 40.23 37.779 39.9 37.779 39.543V10.887C37.779 10.53 37.589 10.199 37.279 10.021L31.168 6.49498C31.014 6.40598 30.841 6.36098 30.669 6.36098C30.496 6.36098 30.323 6.40498 30.169 6.49498L27.295 8.15398V4.83698C27.295 4.47998 27.105 4.14898 26.795 3.97098L20.684 0.441982C20.529 0.352982 20.357 0.307983 20.184 0.307983C20.011 0.307983 19.839 0.352982 19.684 0.441982L13.781 3.85098C13.471 4.02998 13.281 4.35998 13.281 4.71698V12.157L12.921 12.365V11.872C12.921 11.515 12.731 11.185 12.421 11.006L7.405 8.10698C7.25 8.01798 7.077 7.97298 6.905 7.97298C6.733 7.97298 6.56 8.01798 6.405 8.10698L0.501001 11.517C0.191001 11.695 0 12.025 0 12.383ZM1.5 13.248L5.519 15.566V23.294C5.519 23.304 5.524 23.313 5.525 23.323C5.526 23.345 5.529 23.366 5.534 23.388C5.538 23.411 5.544 23.433 5.552 23.455C5.559 23.476 5.567 23.496 5.577 23.516C5.582 23.525 5.581 23.535 5.587 23.544C5.591 23.551 5.6 23.554 5.604 23.561C5.617 23.581 5.63 23.6 5.646 23.618C5.669 23.644 5.695 23.665 5.724 23.686C5.741 23.698 5.751 23.716 5.77 23.727L11.236 26.886C11.243 26.89 11.252 26.888 11.26 26.892C11.328 26.927 11.402 26.952 11.484 26.952C11.566 26.952 11.641 26.928 11.709 26.893C11.728 26.883 11.743 26.87 11.761 26.858C11.812 26.823 11.855 26.781 11.89 26.731C11.898 26.719 11.911 26.715 11.919 26.702C11.924 26.693 11.924 26.682 11.929 26.674C11.944 26.644 11.951 26.613 11.96 26.58C11.969 26.547 11.978 26.515 11.98 26.481C11.98 26.471 11.986 26.462 11.986 26.452V20.138V19.302L17.096 22.251V49.749L1.5 40.747V13.248ZM35.778 10.887L30.879 13.718L25.768 10.766L26.544 10.317L30.668 7.93698L35.778 10.887ZM25.293 4.83598L20.391 7.66498L15.281 4.71598L20.183 1.88398L25.293 4.83598ZM10.92 11.872L6.019 14.701L2.001 12.383L6.904 9.55098L10.92 11.872ZM20.956 16.51L24.268 14.601V18.788C24.268 18.809 24.278 18.827 24.28 18.848C24.284 18.883 24.29 18.917 24.301 18.95C24.311 18.98 24.325 19.007 24.342 19.034C24.358 19.061 24.373 19.088 24.395 19.112C24.417 19.138 24.444 19.159 24.471 19.18C24.489 19.193 24.499 19.21 24.518 19.221L29.878 22.314L23.998 25.708V18.557C23.998 18.547 23.993 18.538 23.992 18.528C23.991 18.506 23.988 18.485 23.984 18.463C23.979 18.44 23.973 18.418 23.965 18.396C23.958 18.375 23.95 18.355 23.941 18.336C23.936 18.327 23.937 18.316 23.931 18.308C23.925 18.299 23.917 18.294 23.911 18.286C23.898 18.267 23.886 18.251 23.871 18.234C23.855 18.216 23.84 18.2 23.822 18.185C23.805 18.17 23.788 18.157 23.769 18.144C23.76 18.138 23.756 18.129 23.747 18.124L20.956 16.51ZM25.268 11.633L30.379 14.585V21.448L25.268 18.499V13.736V11.633ZM12.486 18.437L17.389 15.604L22.498 18.556L17.595 21.385L12.486 18.437ZM10.985 25.587L7.019 23.295L10.985 21.005V25.587ZM12.42 14.385L14.28 13.311L16.822 14.777L12.42 17.32V14.385ZM14.78 5.58198L19.891 8.53098V15.394L14.78 12.445V5.58198Z"
          fill="currentColor"
        />
      </svg>
    </Box>
  </Box>
);

const SKELETON_ROW_COUNT = 12;

const SKELETON_CELL_WIDTHS: Record<string, string> = {
  time: "32px",
  trace: "55%",
  service: "65%",
  duration: "50%",
  cost: "55%",
  tokens: "50%",
  model: "70%",
  evaluations: "75%",
  events: "55%",
};

const TraceTableSkeleton: React.FC = () => {
  const tokens = useDensityTokens();
  const skelTable = useReactTable({
    data: [] as TraceListItem[],
    columns: buildTraceColumns([
      "time",
      "trace",
      "service",
      "duration",
      "cost",
      "tokens",
      "model",
    ]),
    getCoreRowModel: getCoreRowModel(),
  });
  const columns = skelTable.getVisibleLeafColumns();

  return (
    <Box height="full" overflow="auto">
      <TraceTableShell table={skelTable} minWidth="1500px" stickyFirstColumn>
        {Array.from({ length: SKELETON_ROW_COUNT }).map((_, rowIdx) => (
          <Tr
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholders have no stable id
            key={`skel-row-${rowIdx}`}
            borderBottomWidth="1px"
            borderBottomColor="border.muted/60"
          >
            {columns.map((col, i) => {
              const meta = col.columnDef.meta as ColumnMeta | undefined;
              const align = meta?.align ?? "left";
              const size = col.getSize();
              const width = SKELETON_CELL_WIDTHS[col.id] ?? "60%";
              return (
                <Td
                  key={`skel-cell-${col.id}`}
                  width={meta?.flex ? undefined : `${size}px`}
                  minWidth={`${col.columnDef.minSize}px`}
                  textAlign={align}
                  padding={`${tokens.rowPaddingY} 8px`}
                  position={i === 0 ? "sticky" : undefined}
                  left={i === 0 ? 0 : undefined}
                  zIndex={i === 0 ? 1 : undefined}
                  bg={i === 0 ? "bg.surface" : undefined}
                >
                  <Flex
                    justify={align === "right" ? "flex-end" : "flex-start"}
                  >
                    <Skeleton
                      height="10px"
                      width={width}
                      borderRadius="full"
                      opacity={Math.max(0.55 - rowIdx * 0.025, 0.18)}
                      css={{ animationDelay: `${rowIdx * 60}ms` }}
                    />
                  </Flex>
                </Td>
              );
            })}
          </Tr>
        ))}
      </TraceTableShell>
    </Box>
  );
};

const EmptyFilterState: React.FC = () => {
  const clearAll = useFilterStore((s) => s.clearAll);
  const queryText = useFilterStore((s) => s.queryText);
  const timeRange = useFilterStore((s) => s.timeRange);
  const activeLensId = useViewStore((s) => s.activeLensId);

  const hasFilters = queryText.trim().length > 0;
  const rangeHours = (timeRange.to - timeRange.from) / (60 * 60 * 1000);

  const message = useMemo(() => {
    if (activeLensId === "errors") {
      return "No errors in the selected time range";
    }
    if (activeLensId === "conversations") {
      return "No conversations found. Conversations appear when traces include a conversation ID.";
    }
    if (hasFilters) {
      return "No traces match the current filters";
    }
    return "No traces found in the selected time range";
  }, [activeLensId, hasFilters]);

  const rangeHint = useMemo(() => {
    if (hasFilters) return null;
    if (rangeHours < 1) {
      return `The current time range only covers ${Math.round(rangeHours * 60)} minutes. Try expanding to "Last 24 hours" or "Last 7 days".`;
    }
    if (rangeHours < 24) {
      return `The current time range only covers ${Math.round(rangeHours)} hours. Try expanding to "Last 24 hours" or "Last 7 days".`;
    }
    return null;
  }, [hasFilters, rangeHours]);

  return (
    <Flex align="center" justify="center" height="full" padding={8} position="relative">
      <TableWatermark />
      <EmptyState.Root size="md">
        <EmptyState.Content>
          <EmptyState.Indicator>
            <Search />
          </EmptyState.Indicator>
          <VStack textAlign="center" gap={1}>
            <EmptyState.Title>{message}</EmptyState.Title>
            {rangeHint && (
              <EmptyState.Description>{rangeHint}</EmptyState.Description>
            )}
          </VStack>
          {hasFilters && activeLensId === "all-traces" && (
            <Button size="xs" variant="outline" colorPalette="blue" onClick={clearAll}>
              Clear all filters
            </Button>
          )}
        </EmptyState.Content>
      </EmptyState.Root>
    </Flex>
  );
};
