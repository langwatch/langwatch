import {
  Badge,
  Box,
  Button,
  chakra,
  EmptyState,
  Heading,
  HStack,
  Spacer,
  Spinner,
  Stat,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { BarChart3, Bird, Download, X } from "lucide-react";
import Parse from "papaparse";
import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import AiGatewayLayout from "../../ui/sections/gateway-layout";
import {
  resolveTracesHrefForKey,
  type TracesWindow,
} from "../../features/virtual-keys/model/traces-href-for-key";
import { formatBudgetUsd } from "../../model/format-budget-usd";
import { GatewayErrorPanel } from "../../ui/elements/gateway-error-panel";
import { PageLayout } from "@langwatch/design-system/page-layout";
import { Link } from "../../ui/elements/gateway-link";
import { Tooltip as UITooltip } from "@langwatch/design-system/tooltip";
import { useOrganizationTeamProject } from "../../behavior/gateway-session";
import { useRollingWindow } from "../../behavior/use-rolling-window";
import { api } from "../../behavior/gateway-api";
import { useGatewayRouter } from "../../behavior/gateway-router";

/** A query bag as a query string, dropping the keys that have no value. */
function queryString(query: Readonly<Record<string, string | undefined>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== void 0) params.set(key, value);
  }
  return params.toString();
}

const PRESETS: Array<{ label: string; days: number | "mtd" }> = [
  { label: "Last 24h", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
  { label: "This month", days: "mtd" },
];

/**
 * The period the Trace Explorer should open on for the period being read.
 *
 * Three of the five map onto presets the explorer already has. The other
 * two travel as exact instants: it has no 90-day preset at all, and its
 * "this month" starts in the reader's own timezone while this page's starts
 * in UTC, so the preset would open on a different set of days than the
 * numbers above it were computed from.
 */
const TRACE_WINDOW_PRESETS: Record<number, string> = {
  1: "24h",
  7: "7d",
  30: "30d",
};

function traceWindowFor({
  days,
  fromIso,
  toIso,
}: {
  days: number | "mtd";
  fromIso: string;
  toIso: string;
}): TracesWindow {
  const presetId = typeof days === "number" ? TRACE_WINDOW_PRESETS[days] : null;
  if (presetId) return { presetId };
  return {
    fromMs: new Date(fromIso).getTime(),
    toMs: new Date(toIso).getTime(),
  };
}

function GatewayUsagePage() {
  const { organization } = useOrganizationTeamProject();
  const router = useGatewayRouter();

  // Range and key filter live in the URL, so the deep link from the
  // virtual-keys table ("Spent this month" click-through) survives a
  // refresh and can be shared as-is.
  const days = ((): number | "mtd" => {
    const raw = Array.isArray(router.query.days) ? router.query.days[0] : router.query.days;
    if (raw === "mtd") return "mtd";
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return PRESETS.some((p) => p.days === parsed) ? parsed : 30;
  })();
  const virtualKeyId =
    (Array.isArray(router.query.vk) ? router.query.vk[0] : router.query.vk) ?? null;

  // Both of these rewrite the query of the page the reader is already on. The
  // compat router spelled that `push({ pathname: router.pathname, query })`,
  // which needed the route pattern; a bare `"?..."` says the same thing without
  // one, and is what the host's route capability writes.
  const setDays = (next: number | "mtd") => {
    router.push(`?${queryString({ ...router.query, days: next.toString() })}`);
  };
  const clearKeyFilter = () => {
    const { vk: _vk, ...rest } = router.query;
    router.push(`?${queryString(rest)}`);
  };

  const { fromIso, toIso } = useRollingWindow(days);

  const summaryQuery = api.gatewayUsage.summary.useQuery(
    {
      organizationId: organization?.id ?? "",
      fromDate: fromIso,
      toDate: toIso,
    },
    { enabled: !!organization?.id && !virtualKeyId },
  );
  const vkSummaryQuery = api.gatewayUsage.summaryForVirtualKey.useQuery(
    {
      organizationId: organization?.id ?? "",
      virtualKeyId: virtualKeyId ?? "",
      fromDate: fromIso,
      toDate: toIso,
    },
    { enabled: !!organization?.id && !!virtualKeyId },
  );
  const keyQuery = api.virtualKeys.get.useQuery(
    { organizationId: organization?.id ?? "", id: virtualKeyId ?? "" },
    { enabled: !!organization?.id && !!virtualKeyId },
  );
  const filteredKeyName = virtualKeyId ? (keyQuery.data?.name ?? virtualKeyId) : null;
  // Only offered while one key is in focus: the organization-wide view has
  // no single trace destination to open, and the key's own destination is
  // what decides whether there is anything to open at all.
  const viewTracesHref = useMemo(
    () =>
      virtualKeyId && keyQuery.data
        ? resolveTracesHrefForKey({
            teams: organization?.teams ?? [],
            virtualKeyId,
            traceProjectId: keyQuery.data.traceProjectId,
            traceProjectArchived: keyQuery.data.traceProjectArchived,
            window: traceWindowFor({ days, fromIso, toIso }),
          })
        : undefined,
    [virtualKeyId, keyQuery.data, organization?.teams, days, fromIso, toIso],
  );

  const activeQuery = virtualKeyId ? vkSummaryQuery : summaryQuery;
  const data = virtualKeyId
    ? vkSummaryQuery.data && {
        ...vkSummaryQuery.data,
        byVirtualKey: [] as Array<{
          virtualKeyId: string;
          name: string;
          displayPrefix: string | null;
          totalUsd: string;
          requests: number;
        }>,
      }
    : summaryQuery.data;

  // Build a single CSV that flattens the three summary slices the
  // finance reviewer usually wants together: daily spend, spend by
  // virtual key, and spend by model. Section rows separate the three
  // tables so a spreadsheet pivot / chart still reads naturally.
  const exportCsv = () => {
    if (!data) return;
    const rows: (string | number)[][] = [];
    rows.push(["Section", "Key", "Prefix / Model", "Spend (USD)", "Requests"]);
    rows.push(["daily", "day", "", "", ""]);
    for (const d of data.byDay) {
      rows.push(["daily", d.day, "", Number(d.totalUsd).toFixed(6), d.requests]);
    }
    rows.push([]);
    rows.push(["virtual_key", "id", "prefix", "spend", "requests"]);
    for (const vk of data.byVirtualKey) {
      rows.push([
        "virtual_key",
        vk.name,
        vk.displayPrefix ?? "",
        Number(vk.totalUsd).toFixed(6),
        vk.requests,
      ]);
    }
    rows.push([]);
    rows.push(["model", "id", "", "spend", "requests"]);
    for (const m of data.byModel) {
      rows.push(["model", m.model, "", Number(m.totalUsd).toFixed(6), m.requests]);
    }
    const csv = Parse.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const stamp = new Date().toISOString().split("T")[0];
    link.setAttribute(
      "download",
      `gateway_usage_${organization?.slug ?? "organization"}${
        virtualKeyId ? `_${virtualKeyId}` : ""
      }_${days === "mtd" ? "mtd" : `${days}d`}_${stamp}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  return (
    <AiGatewayLayout>
      <>
        <PageLayout.Header>
          <PageLayout.Heading>Usage</PageLayout.Heading>
          {filteredKeyName && (
            <Badge
              variant="subtle"
              colorPalette="orange"
              marginLeft={3}
              data-testid="usage-key-filter"
            >
              <HStack gap={1}>
                <Text>Key: {filteredKeyName}</Text>
                <chakra.button
                  type="button"
                  aria-label="Clear key filter"
                  onClick={clearKeyFilter}
                  cursor="pointer"
                  display="inline-flex"
                >
                  <X size={12} />
                </chakra.button>
              </HStack>
            </Badge>
          )}
          <Spacer />
          <HStack gap={1}>
            {PRESETS.map((p) => (
              <Box
                key={p.days}
                as="button"
                paddingX={3}
                paddingY={1}
                borderRadius="md"
                fontSize="xs"
                fontWeight={days === p.days ? "semibold" : "normal"}
                background={days === p.days ? "orange.100" : "transparent"}
                color={days === p.days ? "orange.800" : "fg.muted"}
                borderWidth="1px"
                borderColor={days === p.days ? "orange.300" : "border.subtle"}
                onClick={() => setDays(p.days)}
              >
                {p.label}
              </Box>
            ))}
            <Button
              size="xs"
              variant="outline"
              onClick={exportCsv}
              disabled={!data || data.totalRequests === 0}
              marginLeft={2}
            >
              <Download size={12} /> Export CSV
            </Button>
          </HStack>
        </PageLayout.Header>

        <Box padding={6} width="full" maxWidth="1600px" marginX="auto">
          {activeQuery.isLoading ? (
            <Spinner />
          ) : activeQuery.isError ? (
            <GatewayErrorPanel
              title="Failed to load usage"
              error={activeQuery.error}
              onRetry={() => activeQuery.refetch()}
            />
          ) : !data || data.totalRequests === 0 ? (
            <EmptyState.Root>
              <EmptyState.Content>
                <EmptyState.Indicator>
                  <BarChart3 size={32} />
                </EmptyState.Indicator>
                <EmptyState.Title>No usage in this window</EmptyState.Title>
                <EmptyState.Description>
                  Spend shows up here once the gateway has traced its first completed request. Send
                  a few requests against a virtual key, then check back in a couple of minutes.
                </EmptyState.Description>
              </EmptyState.Content>
            </EmptyState.Root>
          ) : (
            <VStack align="stretch" gap={6}>
              <HStack gap={4} align="stretch">
                <StatTile label="Total spend" value={formatBudgetUsd(data.totalUsd)} />
                <StatTile
                  label="Requests"
                  value={data.totalRequests.toLocaleString()}
                  help="Every dispatch attempt is counted, including upstream 4xx/5xx responses. Failed-auth requests don't bill tokens but do ledger as 0-cost entries so blip-driven spikes stay visible in ops review."
                />
                <StatTile label="Avg $/request" value={formatAvgCost(data.avgUsdPerRequest)} />
                <StatTile
                  label="Blocked by guardrail"
                  value={data.blockedRequests.toLocaleString()}
                  tone={data.blockedRequests > 0 ? "red" : undefined}
                />
              </HStack>

              {data.byDay.length >= 2 && <SpendSparkline byDay={data.byDay} />}

              {!virtualKeyId && (
                <VStack align="stretch" gap={2}>
                  <Heading size="sm">Top virtual keys</Heading>
                  <Table.Root size="sm">
                    <Table.Header>
                      <Table.Row>
                        <Table.ColumnHeader>Key</Table.ColumnHeader>
                        <Table.ColumnHeader>Prefix</Table.ColumnHeader>
                        <Table.ColumnHeader>Spend</Table.ColumnHeader>
                        <Table.ColumnHeader>Requests</Table.ColumnHeader>
                      </Table.Row>
                    </Table.Header>
                    <Table.Body>
                      {data.byVirtualKey.map((row) => (
                        <Table.Row key={row.virtualKeyId}>
                          <Table.Cell>
                            <Link href={`/gateway/virtual-keys/${row.virtualKeyId}`}>
                              {row.name}
                            </Link>
                          </Table.Cell>
                          <Table.Cell>
                            <Text fontFamily="mono" fontSize="xs">
                              {row.displayPrefix}…
                            </Text>
                          </Table.Cell>
                          <Table.Cell>{formatBudgetUsd(row.totalUsd)}</Table.Cell>
                          <Table.Cell>{row.requests}</Table.Cell>
                        </Table.Row>
                      ))}
                    </Table.Body>
                  </Table.Root>
                </VStack>
              )}

              <VStack align="stretch" gap={2}>
                <HStack>
                  <Heading size="sm">Top models</Heading>
                  <Spacer />
                  {viewTracesHref && (
                    <Link href={viewTracesHref}>
                      <Button variant="outline" size="xs" data-testid="usage-view-all-traces">
                        <Bird size={14} /> View all traces
                      </Button>
                    </Link>
                  )}
                </HStack>
                <Table.Root size="sm">
                  <Table.Header>
                    <Table.Row>
                      <Table.ColumnHeader>Model</Table.ColumnHeader>
                      <Table.ColumnHeader>Spend</Table.ColumnHeader>
                      <Table.ColumnHeader>Requests</Table.ColumnHeader>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {data.byModel.map((row) => (
                      <Table.Row key={row.model}>
                        <Table.Cell>
                          <Text fontFamily="mono" fontSize="xs">
                            {row.model}
                          </Text>
                        </Table.Cell>
                        <Table.Cell>{formatBudgetUsd(row.totalUsd)}</Table.Cell>
                        <Table.Cell>{row.requests}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </VStack>
            </VStack>
          )}
        </Box>
      </>
    </AiGatewayLayout>
  );
}

function SpendSparkline({
  byDay,
}: {
  byDay: Array<{ day: string; totalUsd: string; requests: number }>;
}) {
  const points = useMemo(
    () =>
      byDay.map((p) => ({
        day: p.day,
        spendUsd: Number(p.totalUsd),
        requests: p.requests,
      })),
    [byDay],
  );
  return (
    <VStack align="stretch" gap={2}>
      <HStack>
        <Heading size="sm">Spend over time</Heading>
        <Spacer />
        <Text fontSize="xs" color="fg.muted">
          day-bucketed UTC
        </Text>
      </HStack>
      <Box
        borderWidth="1px"
        borderColor="border.subtle"
        borderRadius="lg"
        padding={3}
        height="220px"
      >
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f97316" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#f97316" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 11, fill: "#64748b" }}
              tickFormatter={formatDayTick}
              minTickGap={24}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#64748b" }}
              tickFormatter={(v: number) => `$${v.toFixed(2)}`}
              width={56}
            />
            <Tooltip
              formatter={(value, name) =>
                name === "spendUsd" ? [`$${Number(value).toFixed(4)}`, "Spend"] : [value, name]
              }
              labelFormatter={(label) => String(label ?? "")}
              contentStyle={{ fontSize: 12 }}
            />
            <Area
              type="monotone"
              dataKey="spendUsd"
              stroke="#f97316"
              strokeWidth={2}
              fill="url(#spendFill)"
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </Box>
    </VStack>
  );
}

function formatDayTick(day: string): string {
  const [, mm, dd] = day.split("-");
  if (!mm || !dd) return day;
  return `${mm}/${dd}`;
}

// Avg-cost often sits in $0.001–$0.1; 2 decimals rounds to $0.00 and
// 6 decimals is noisy. Match the same logic as the ledger-line
// formatter on budget detail.
function formatAvgCost(raw: string | number): string {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return "—";
  if (n >= 1) return `$${n.toFixed(4)}`;
  if (n >= 0.01) return `$${n.toFixed(5)}`;
  return `$${n.toFixed(6)}`;
}

function StatTile({
  label,
  value,
  tone,
  help,
}: {
  label: string;
  value: string;
  tone?: "red";
  help?: string;
}) {
  const body = (
    <Stat.Root>
      <Stat.Label>{label}</Stat.Label>
      <Stat.ValueText color={tone === "red" ? "red.600" : undefined}>{value}</Stat.ValueText>
    </Stat.Root>
  );
  return (
    <Box flex={1} borderWidth="1px" borderColor="border.subtle" borderRadius="lg" padding={4}>
      {help ? <UITooltip content={help}>{body}</UITooltip> : body}
    </Box>
  );
}

export default GatewayUsagePage;
