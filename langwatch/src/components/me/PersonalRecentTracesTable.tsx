import { Box, HStack, Spinner, Text } from "@chakra-ui/react";
import {
  type ColumnDef,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useMemo } from "react";
import { buildTraceColumns } from "~/features/traces-v2/components/TraceTable/columns";
import {
  RegistryRow,
  traceRegistry,
} from "~/features/traces-v2/components/TraceTable/registry";
import { TraceTableShell } from "~/features/traces-v2/components/TraceTable/TraceTableShell";
import { TraceStatisticsProvider } from "~/features/traces-v2/components/TraceTable/traceStatisticsContext";
import type { TraceListItem } from "~/features/traces-v2/types/trace";
import { mapTraceListPayload } from "~/features/traces-v2/utils/mapTraceListPayload";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

const RECENT_WINDOW_DAYS = 30;
const RECENT_LIMIT = 10;

// Mirror the explorer's default "All" lens: the same trace cells plus the
// io-preview second-row addon (the Input/Output summary). Rendering through
// the explorer's own TraceTableShell + RegistryRow keeps the header
// typography, row borders, density, and the summary row pixel-identical to
// /traces instead of re-styling a parallel table.
const RECENT_COLUMN_IDS = [
  "time",
  "trace",
  "origin",
  "duration",
  "cost",
  "tokens",
];
const RECENT_ADDONS = ["io-preview"];

const FALLBACK_COL_MIN_PX = 100;

function isFlexColumn(def: ColumnDef<TraceListItem, any>): boolean {
  return Boolean((def.meta as { flex?: boolean } | undefined)?.flex);
}

/**
 * The "Recent activity" card on /me, rendered with the /traces v2 table
 * itself, scoped to the user's personal project. Clicking a row deep-links
 * into the full trace explorer with the detail drawer open, so the user
 * lands on the same trace they clicked. Reading the personal project tenant
 * directly (rather than the gateway ledger the old card used) means Path B
 * OTLP traces (Claude Code et al.) show up here too, not just gateway-routed
 * requests.
 */
export function PersonalRecentTracesTable({
  projectId,
  projectSlug,
}: {
  projectId: string;
  projectSlug: string;
}) {
  const router = useRouter();

  const timeRange = useMemo(() => {
    const to = Date.now();
    return {
      from: to - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000,
      to,
      live: false,
    };
  }, []);

  const query = api.tracesV2.list.useQuery(
    {
      projectId,
      timeRange,
      sort: { columnId: "time", direction: "desc" },
      // The list endpoint paginates 1-based (page.min(1)); page 0 fails
      // input validation and the table silently renders empty.
      page: 1,
      pageSize: RECENT_LIMIT,
    },
    { enabled: !!projectId, staleTime: 60_000, keepPreviousData: true },
  );

  const rows = useMemo(() => mapTraceListPayload(query.data), [query.data]);

  // The explorer pins the trace column at a fixed 560px so the wide lens can
  // scroll; in this compact card we widen it back to flex so the trace name
  // absorbs the card's slack instead of forcing horizontal scroll. The
  // shared column defs are spread (never mutated) so the explorer's own
  // columns are untouched.
  const columns = useMemo(
    () =>
      buildTraceColumns(RECENT_COLUMN_IDS).map((col) =>
        col.id === "trace"
          ? { ...col, size: 9999, meta: { ...col.meta, flex: true } }
          : col,
      ),
    [],
  );

  const minWidth = useMemo(() => {
    const px = columns.reduce((sum, col) => {
      const width = isFlexColumn(col)
        ? (col.minSize ?? FALLBACK_COL_MIN_PX)
        : (col.size ?? col.minSize ?? FALLBACK_COL_MIN_PX);
      return sum + width;
    }, 0);
    return `${px}px`;
  }, [columns]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.traceId,
    // A 10-row preview card: sorting + resizing belong to the full explorer,
    // not here. Disabling them keeps the headers as plain, non-interactive
    // labels (no chevrons, no resize grips) while preserving the exact
    // header styling from TraceTableShell.
    enableSorting: false,
    enableColumnResizing: false,
  });

  const openTrace = (row: TraceListItem) => {
    const params = new URLSearchParams({
      "drawer.open": "traceV2Details",
      "drawer.traceId": row.traceId,
      "drawer.t": String(row.timestamp),
    });
    void router.push(`/${projectSlug}/traces?${params.toString()}`);
  };

  if (query.isLoading) {
    return (
      <HStack justify="center" paddingY={6}>
        <Spinner size="sm" color="fg.muted" />
      </HStack>
    );
  }

  if (rows.length === 0) {
    return (
      <Text fontSize="sm" color="fg.muted" paddingY={4} textAlign="center">
        No requests yet
      </Text>
    );
  }

  return (
    <TraceStatisticsProvider traces={rows}>
      <Box overflowX="auto" width="full">
        <TraceTableShell table={table} minWidth={minWidth}>
          {table.getRowModel().rows.map((row) => (
            <RegistryRow
              key={row.id}
              tanstackRow={row}
              registry={traceRegistry}
              addons={RECENT_ADDONS}
              status={row.original.status}
              hoverScope="unified"
              rowDomId={row.original.traceId}
              onSelect={() => openTrace(row.original)}
            />
          ))}
        </TraceTableShell>
      </Box>
    </TraceStatisticsProvider>
  );
}
