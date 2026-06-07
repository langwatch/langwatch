import { HStack, Spinner, Table, Text } from "@chakra-ui/react";
import { Fragment, useMemo } from "react";
import { IOPreview } from "~/features/traces-v2/components/TraceTable/IOPreview";
import { CostCell } from "~/features/traces-v2/components/TraceTable/registry/cells/trace/CostCell";
import { DurationCell } from "~/features/traces-v2/components/TraceTable/registry/cells/trace/DurationCell";
import { OriginCell } from "~/features/traces-v2/components/TraceTable/registry/cells/trace/SimpleCells";
import { TimeCell } from "~/features/traces-v2/components/TraceTable/registry/cells/trace/TimeCell";
import { TokensCell } from "~/features/traces-v2/components/TraceTable/registry/cells/trace/TokensCell";
import { TraceCell } from "~/features/traces-v2/components/TraceTable/registry/cells/trace/TraceCell";
import type {
  CellDef,
  CellRenderContext,
} from "~/features/traces-v2/components/TraceTable/registry/types";
import { TraceStatisticsProvider } from "~/features/traces-v2/components/TraceTable/traceStatisticsContext";
import { useDensityTokens } from "~/features/traces-v2/hooks/useDensityTokens";
import { useDensityStore } from "~/features/traces-v2/stores/densityStore";
import type { TraceListItem } from "~/features/traces-v2/types/trace";
import { mapTraceListPayload } from "~/features/traces-v2/utils/mapTraceListPayload";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

const RECENT_WINDOW_DAYS = 30;
const RECENT_LIMIT = 10;

interface ReusedColumn {
  cell: CellDef<TraceListItem>;
  label: string;
  align: "start" | "end";
}

// Reuse the exact /traces table cells so a personal trace reads the
// same way it does in the trace explorer. The column set mirrors the
// explorer's default lens (time / trace / origin / duration / cost /
// tokens) and each row carries the same Input/Output summary preview
// below it (see IOPreview), so Recent Activity matches /traces.
const COLUMNS: ReusedColumn[] = [
  { cell: TimeCell, label: "Time", align: "start" },
  { cell: TraceCell, label: "Trace", align: "start" },
  { cell: OriginCell, label: "Origin", align: "start" },
  { cell: DurationCell, label: "Duration", align: "end" },
  { cell: CostCell, label: "Cost", align: "end" },
  { cell: TokensCell, label: "Tokens", align: "end" },
];

function renderCell(
  cell: CellDef<TraceListItem>,
  ctx: CellRenderContext<TraceListItem>,
) {
  return cell.renderComfortable
    ? cell.renderComfortable(ctx)
    : cell.render(ctx);
}

/**
 * The "Recent activity" card on /me, rendered with the /traces v2 table
 * cells against the user's personal project. Clicking a row deep-links
 * into the full trace explorer with the detail drawer open, so the user
 * lands on the same trace they clicked — no second lookup. Reading the
 * personal project tenant directly (rather than the gateway ledger the
 * old card used) means Path B OTLP traces (Claude Code et al.) show up
 * here too, not just gateway-routed requests.
 */
export function PersonalRecentTracesTable({
  projectId,
  projectSlug,
}: {
  projectId: string;
  projectSlug: string;
}) {
  const router = useRouter();
  const density = useDensityTokens();
  const densityMode = useDensityStore((s) => s.density);

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
      <Table.Root size="sm" variant="line" width="full">
        <Table.Header>
          <Table.Row backgroundColor="transparent">
            {COLUMNS.map(({ cell, label, align }) => (
              <Table.ColumnHeader
                key={cell.id}
                paddingX={2}
                color="fg.muted"
                fontWeight="medium"
                textAlign={align}
              >
                {label}
              </Table.ColumnHeader>
            ))}
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {rows.map((row) => {
            const ctx: CellRenderContext<TraceListItem> = {
              row,
              density,
              densityMode,
              isExpanded: false,
              isSelected: false,
              isFocused: false,
              actions: {},
              enabledAddonIds: [],
            };
            return (
              <Fragment key={row.traceId}>
                <Table.Row
                  cursor="pointer"
                  _hover={{ backgroundColor: "bg.muted" }}
                  onClick={() => openTrace(row)}
                  // Match the trace explorer's hover affordance: the trace id
                  // fades in on row hover (TraceCell keeps it at opacity 0 by
                  // default), kept dense until you reach for it.
                  css={{ "&:hover [data-row-hover-reveal]": { opacity: 1 } }}
                >
                  {COLUMNS.map(({ cell, align }) => (
                    <Table.Cell
                      key={cell.id}
                      paddingX={2}
                      textAlign={align}
                      verticalAlign="middle"
                      // The trace column absorbs the slack and truncates long
                      // names; the metric columns size to their content. The
                      // `max-width: 0` + `width: 100%` pair is the table-cell
                      // truncation idiom that bounds the cell so the inner
                      // `truncate` actually clips.
                      width={cell.id === "trace" ? "100%" : undefined}
                      maxWidth={cell.id === "trace" ? "0" : undefined}
                    >
                      {renderCell(cell, ctx)}
                    </Table.Cell>
                  ))}
                </Table.Row>
                {/* Mirror the io-preview addon: LLM traces with both input AND
                    output get the same Input/Output summary row beneath them
                    that the /traces explorer renders. */}
                {row.input !== null && row.output !== null && (
                  <Table.Row
                    cursor="pointer"
                    _hover={{ backgroundColor: "bg.muted" }}
                    onClick={() => openTrace(row)}
                  >
                    <Table.Cell
                      colSpan={COLUMNS.length}
                      paddingX={2}
                      paddingTop={0}
                      paddingBottom={3}
                      borderTopWidth={0}
                    >
                      <IOPreview input={row.input} output={row.output} />
                    </Table.Cell>
                  </Table.Row>
                )}
              </Fragment>
            );
          })}
        </Table.Body>
      </Table.Root>
    </TraceStatisticsProvider>
  );
}
