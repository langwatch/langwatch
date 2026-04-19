import {
  Box,
  Button,
  EmptyState,
  HStack,
  Heading,
  Spacer,
  Spinner,
  Stat,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import { BarChart3, Download } from "lucide-react";
import Parse from "papaparse";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { DashboardLayout } from "~/components/DashboardLayout";
import { withPermissionGuard } from "~/components/WithPermissionGuard";
import { GatewayErrorPanel } from "~/components/gateway/GatewayErrorPanel";
import { GatewayLayout } from "~/components/gateway/GatewayLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { Link } from "~/components/ui/link";
import { Tooltip as UITooltip } from "~/components/ui/tooltip";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

const PRESETS: Array<{ label: string; days: number }> = [
  { label: "Last 24h", days: 1 },
  { label: "Last 7 days", days: 7 },
  { label: "Last 30 days", days: 30 },
  { label: "Last 90 days", days: 90 },
];

function GatewayUsagePage() {
  const { project } = useOrganizationTeamProject();
  const [days, setDays] = useState(30);

  const { fromIso, toIso } = useMemo(() => {
    const to = new Date();
    const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
    return { fromIso: from.toISOString(), toIso: to.toISOString() };
  }, [days]);

  const summaryQuery = api.gatewayUsage.summary.useQuery(
    { projectId: project?.id ?? "", fromDate: fromIso, toDate: toIso },
    { enabled: !!project?.id },
  );

  const data = summaryQuery.data;

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
      rows.push([
        "model",
        m.model,
        "",
        Number(m.totalUsd).toFixed(6),
        m.requests,
      ]);
    }
    const csv = Parse.unparse(rows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const stamp = new Date().toISOString().split("T")[0];
    link.setAttribute(
      "download",
      `gateway_usage_${project?.slug ?? "project"}_${days}d_${stamp}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  };

  return (
    <GatewayLayout>
      <>
        <PageLayout.Header>
          <PageLayout.Heading>Usage</PageLayout.Heading>
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
          {summaryQuery.isLoading ? (
            <Spinner />
          ) : summaryQuery.isError ? (
            <GatewayErrorPanel
              title="Failed to load usage"
              error={summaryQuery.error}
              onRetry={() => summaryQuery.refetch()}
            />
          ) : !data || data.totalRequests === 0 ? (
            <EmptyState.Root>
              <EmptyState.Content>
                <EmptyState.Indicator>
                  <BarChart3 size={32} />
                </EmptyState.Indicator>
                <EmptyState.Title>No usage in this window</EmptyState.Title>
                <EmptyState.Description>
                  Spend shows up here once the gateway debits budgets after a
                  completed request. Try sending a few requests against a
                  virtual key, then come back in a couple of minutes.
                </EmptyState.Description>
              </EmptyState.Content>
            </EmptyState.Root>
          ) : (
            <VStack align="stretch" gap={6}>
              <HStack gap={4} align="stretch">
                <StatTile
                  label="Total spend"
                  value={`$${Number(data.totalUsd).toFixed(2)}`}
                />
                <StatTile
                  label="Requests"
                  value={data.totalRequests.toLocaleString()}
                  help="Every dispatch attempt is counted, including upstream 4xx/5xx responses. Failed-auth requests don't bill tokens but do ledger as 0-cost entries so blip-driven spikes stay visible in ops review."
                />
                <StatTile
                  label="Avg $/request"
                  value={formatAvgCost(data.avgUsdPerRequest)}
                />
                <StatTile
                  label="Blocked by guardrail"
                  value={data.blockedRequests.toLocaleString()}
                  tone={data.blockedRequests > 0 ? "red" : undefined}
                />
              </HStack>

              {data.byDay.length >= 2 && <SpendSparkline byDay={data.byDay} />}

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
                          <Link
                            href={`/${project?.slug}/gateway/virtual-keys/${row.virtualKeyId}`}
                          >
                            {row.name}
                          </Link>
                        </Table.Cell>
                        <Table.Cell>
                          <Text fontFamily="mono" fontSize="xs">
                            {row.displayPrefix}…
                          </Text>
                        </Table.Cell>
                        <Table.Cell>
                          ${Number(row.totalUsd).toFixed(2)}
                        </Table.Cell>
                        <Table.Cell>{row.requests}</Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Root>
              </VStack>

              <VStack align="stretch" gap={2}>
                <Heading size="sm">Top models</Heading>
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
                        <Table.Cell>
                          ${Number(row.totalUsd).toFixed(2)}
                        </Table.Cell>
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
    </GatewayLayout>
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
          ledger-backed, day-bucketed UTC
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
                name === "spendUsd"
                  ? [`$${Number(value).toFixed(4)}`, "Spend"]
                  : [value, name]
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
      <Stat.ValueText color={tone === "red" ? "red.600" : undefined}>
        {value}
      </Stat.ValueText>
    </Stat.Root>
  );
  return (
    <Box
      flex={1}
      borderWidth="1px"
      borderColor="border.subtle"
      borderRadius="lg"
      padding={4}
    >
      {help ? <UITooltip content={help}>{body}</UITooltip> : body}
    </Box>
  );
}

export default withPermissionGuard("gatewayUsage:view", {
  layoutComponent: DashboardLayout,
})(GatewayUsagePage);
