import { useMemo, useRef } from "react";
import {
  Badge,
  Box,
  Card,
  Center,
  EmptyState,
  HStack,
  SimpleGrid,
  Spinner,
  Stat,
  Status,
  Table,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Area,
  AreaChart,
  Brush,
  CartesianGrid,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowUpRight } from "lucide-react";
import NextLink from "next/link";
import { Spacer } from "@chakra-ui/react";
import { useRouter } from "next/router";
import { useEffect } from "react";
import { useOpsSSE } from "~/hooks/useOpsSSE";
import type { ConnectionStatus as ConnectionStatusType } from "~/hooks/useOpsSSE";
import type { DashboardData } from "~/server/app-layer/ops/types";
import { api } from "~/utils/api";
import { DashboardLayout } from "~/components/DashboardLayout";
import { PageLayout } from "~/components/ui/layouts/PageLayout";
import { useOpsPermission } from "~/hooks/useOpsPermission";

function formatRate(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  if (value >= 100) return value.toFixed(0);
  if (value >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatCount(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return value.toString();
}

function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${ms.toFixed(0)}ms`;
}

function formatDuration(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return "—";
  const ms = new Date(completedAt).getTime() - new Date(startedAt).getTime();
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

export function ConnectionStatusIndicator({
  status,
}: {
  status: ConnectionStatusType;
}) {
  const colorMap: Record<ConnectionStatusType, "green" | "orange" | "red"> = {
    connected: "green",
    connecting: "orange",
    disconnected: "red",
  };
  const labelMap: Record<ConnectionStatusType, string> = {
    connected: "Live",
    connecting: "Connecting",
    disconnected: "Disconnected",
  };

  return (
    <Status.Root size="sm" colorPalette={colorMap[status]}>
      <Status.Indicator />
      {labelMap[status]}
    </Status.Root>
  );
}

function LinkedStat({
  label,
  value,
  sublabel,
  href,
  color,
}: {
  label: string;
  value: string;
  sublabel?: string;
  href?: string;
  color?: string;
}) {
  const content = (
    <Stat.Root
      cursor={href ? "pointer" : undefined}
      _hover={href ? { bg: "bg.subtle" } : undefined}
      borderRadius="md"
      padding={2}
      transition="background 0.1s"
    >
      <Stat.Label>
        <HStack gap={1}>
          <Text>{label}</Text>
          {href && <ArrowUpRight size={10} />}
        </HStack>
      </Stat.Label>
      <HStack gap={1.5} alignItems="baseline">
        <Stat.ValueText color={color}>{value}</Stat.ValueText>
        {sublabel && (
          <Text textStyle="xs" color="fg.muted" fontWeight="normal">
            {sublabel}
          </Text>
        )}
      </HStack>
    </Stat.Root>
  );

  if (!href) return content;

  return (
    <NextLink href={href} style={{ textDecoration: "none" }}>
      {content}
    </NextLink>
  );
}

interface ChartPoint {
  time: string;
  staged: number;
  completed: number;
  failed: number;
  pending: number;
  blocked: number;
}

function ThroughputChart({ data }: { data: DashboardData }) {
  const yMaxRef = useRef(1);

  const chartData = useMemo<ChartPoint[]>(() => {
    return data.throughputHistory.map((point) => ({
      time: new Date(point.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      staged: point.ingestedPerSec,
      completed: point.completedPerSec,
      failed: point.failedPerSec,
      pending: point.pendingCount,
      blocked: point.blockedCount,
    }));
  }, [data.throughputHistory]);

  const yMax = useMemo(() => {
    if (chartData.length === 0) return 1;
    let max = 0;
    for (const p of chartData) {
      max = Math.max(max, p.staged, p.completed, p.failed);
    }
    const rounded = max <= 1 ? 1 : Math.ceil(max * 1.2);
    if (rounded > yMaxRef.current) {
      yMaxRef.current = rounded;
    }
    return yMaxRef.current;
  }, [chartData]);

  const yMaxRight = useMemo(() => {
    if (chartData.length === 0) return 10;
    let max = 0;
    for (const p of chartData) {
      max = Math.max(max, p.pending, p.blocked);
    }
    return max <= 0 ? 10 : Math.ceil(max * 1.2);
  }, [chartData]);

  if (chartData.length < 3) {
    return (
      <Center height="200px">
        <VStack gap={2}>
          <Spinner size="sm" />
          <Text textStyle="xs" color="fg.muted">
            Collecting data ({chartData.length} points)...
          </Text>
        </VStack>
      </Center>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="gradStaged" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradCompleted" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#22c55e" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradFailed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.15} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid
          strokeDasharray="3 3"
          stroke="var(--chakra-colors-border)"
          vertical={false}
        />
        <XAxis
          dataKey="time"
          tick={{ fontSize: 10, fill: "var(--chakra-colors-fg-muted)" }}
          axisLine={false}
          tickLine={false}
          interval="preserveStartEnd"
          minTickGap={60}
        />
        <YAxis
          yAxisId="rate"
          tick={{ fontSize: 10, fill: "var(--chakra-colors-fg-muted)" }}
          axisLine={false}
          tickLine={false}
          width={36}
          domain={[0, yMax]}
          allowDataOverflow
        />
        <YAxis
          yAxisId="count"
          orientation="right"
          tick={{ fontSize: 10, fill: "var(--chakra-colors-fg-muted)" }}
          axisLine={false}
          tickLine={false}
          width={36}
          domain={[0, yMaxRight]}
          allowDataOverflow
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "var(--chakra-colors-bg-panel)",
            border: "1px solid var(--chakra-colors-border)",
            borderRadius: "8px",
            fontSize: "11px",
            padding: "8px 12px",
          }}
          formatter={(value: number, name: string) => {
            if (name === "Pending" || name === "Blocked") return [value.toLocaleString(), name];
            return [value.toFixed(2), name];
          }}
        />
        <Legend
          iconType="circle"
          iconSize={6}
          wrapperStyle={{ fontSize: "11px", paddingTop: "4px" }}
        />
        <Area
          yAxisId="rate"
          type="monotone"
          dataKey="staged"
          stroke="#06b6d4"
          fill="url(#gradStaged)"
          strokeWidth={1.5}
          name="Staged/s"
          isAnimationActive={false}
        />
        <Area
          yAxisId="rate"
          type="monotone"
          dataKey="completed"
          stroke="#22c55e"
          fill="url(#gradCompleted)"
          strokeWidth={1.5}
          name="Completed/s"
          isAnimationActive={false}
        />
        <Area
          yAxisId="rate"
          type="monotone"
          dataKey="failed"
          stroke="#ef4444"
          fill="url(#gradFailed)"
          strokeWidth={1.5}
          name="Failed/s"
          isAnimationActive={false}
        />
        <Line
          yAxisId="count"
          type="stepAfter"
          dataKey="pending"
          stroke="#a78bfa"
          strokeWidth={1}
          strokeDasharray="4 2"
          dot={false}
          name="Pending"
          isAnimationActive={false}
        />
        <Line
          yAxisId="count"
          type="stepAfter"
          dataKey="blocked"
          stroke="#f97316"
          strokeWidth={1}
          strokeDasharray="4 2"
          dot={false}
          name="Blocked"
          isAnimationActive={false}
        />
        <Brush
          dataKey="time"
          height={20}
          stroke="var(--chakra-colors-border)"
          fill="var(--chakra-colors-bg-subtle)"
          travellerWidth={8}
          tickFormatter={() => ""}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function ActiveOperationsSection({
  data,
}: {
  data: DashboardData;
}) {
  const statusQuery = api.ops.getReplayStatus.useQuery(undefined, {
    refetchInterval: 2000,
  });

  const replayStatus = statusQuery.data;
  const isReplayRunning = replayStatus?.state === "running";
  const pausedKeys = data.pausedKeys;
  const hasPaused = pausedKeys.length > 0;

  if (!isReplayRunning && !hasPaused) return null;

  return (
    <Card.Root overflow="hidden">
      <Text
        textStyle="xs"
        fontWeight="medium"
        color="fg.muted"
        paddingX={4}
        paddingTop={3}
        paddingBottom={2}
      >
        Active Operations
      </Text>
      <VStack align="stretch" gap={0} paddingX={4} paddingBottom={3}>
        {isReplayRunning && replayStatus && (
          <HStack
            gap={2}
            paddingY={2}
            borderBottom={hasPaused ? "1px solid" : undefined}
            borderBottomColor="border"
          >
            <Status.Root colorPalette="blue" size="sm">
              <Status.Indicator />
            </Status.Root>
            <Text textStyle="sm" fontWeight="medium">
              Replay running
            </Text>
            {replayStatus.currentProjection && (
              <Badge size="sm" variant="subtle" colorPalette="blue">
                {replayStatus.currentProjection}
              </Badge>
            )}
            <Spacer />
            {replayStatus.runId && (
              <NextLink
                href={`/ops/projections/${replayStatus.runId}`}
                style={{ textDecoration: "none" }}
              >
                <Text textStyle="xs" color="blue.500" cursor="pointer">
                  View progress
                </Text>
              </NextLink>
            )}
          </HStack>
        )}
        {hasPaused && (
          <VStack align="stretch" gap={1} paddingY={2}>
            <Text textStyle="xs" color="fg.muted">
              Paused pipelines
            </Text>
            <HStack gap={2} flexWrap="wrap">
              {pausedKeys.map((key) => (
                <Badge
                  key={key}
                  size="sm"
                  colorPalette="orange"
                  variant="subtle"
                >
                  {key}
                </Badge>
              ))}
            </HStack>
          </VStack>
        )}
      </VStack>
    </Card.Root>
  );
}

function ReplayHistorySection() {
  const historyQuery = api.ops.getReplayHistory.useQuery(undefined, {
    refetchInterval: 10000,
  });

  const entries = historyQuery.data ?? [];
  // Show only the latest entry on the dashboard
  const latestEntry = entries[0];

  return (
    <Card.Root overflow="hidden">
      <NextLink href="/ops/projections" style={{ textDecoration: "none" }}>
        <HStack
          paddingX={4}
          paddingTop={3}
          paddingBottom={2}
          cursor="pointer"
          _hover={{ color: "orange.500" }}
          transition="color 0.1s"
        >
          <Text textStyle="xs" fontWeight="medium" color="fg.muted">
            Replay History
          </Text>
          <ArrowUpRight size={10} />
        </HStack>
      </NextLink>
      {latestEntry ? (
        <Table.ScrollArea>
          <Table.Root size="sm" variant="line" css={{ "& tr:last-child td": { borderBottom: "none" } }}>
            <Table.Header>
              <Table.Row>
                <Table.ColumnHeader>Status</Table.ColumnHeader>
                <Table.ColumnHeader>Description</Table.ColumnHeader>
                <Table.ColumnHeader textAlign="end">Duration</Table.ColumnHeader>
                <Table.ColumnHeader>When</Table.ColumnHeader>
                <Table.ColumnHeader width="40px" />
              </Table.Row>
            </Table.Header>
            <Table.Body>
              <Table.Row>
                <Table.Cell>
                  <Badge
                    size="sm"
                    colorPalette={
                      latestEntry.state === "completed"
                        ? "green"
                        : latestEntry.state === "failed"
                          ? "red"
                          : latestEntry.state === "running"
                            ? "blue"
                            : "orange"
                    }
                  >
                    {latestEntry.state}
                  </Badge>
                </Table.Cell>
                <Table.Cell>
                  <Text textStyle="xs" truncate maxWidth="240px">
                    {latestEntry.description || "—"}
                  </Text>
                </Table.Cell>
                <Table.Cell textAlign="end">
                  <Text textStyle="xs">
                    {formatDuration(latestEntry.startedAt, latestEntry.completedAt)}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <Text textStyle="xs" color="fg.muted" whiteSpace="nowrap">
                    {latestEntry.completedAt
                      ? new Date(latestEntry.completedAt).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : "—"}
                  </Text>
                </Table.Cell>
                <Table.Cell>
                  <NextLink
                    href={`/ops/projections/${latestEntry.runId}`}
                    style={{ textDecoration: "none" }}
                  >
                    <ArrowUpRight
                      size={12}
                      style={{ cursor: "pointer", opacity: 0.5 }}
                    />
                  </NextLink>
                </Table.Cell>
              </Table.Row>
            </Table.Body>
          </Table.Root>
        </Table.ScrollArea>
      ) : (
        <Box paddingX={4} paddingBottom={4}>
          <Text textStyle="xs" color="fg.muted">
            No replay history
          </Text>
        </Box>
      )}
    </Card.Root>
  );
}

function OpsDashboardContent({ data }: { data: DashboardData }) {
  const totalBlocked = data.queues.reduce(
    (sum, q) => sum + q.blockedGroupCount,
    0,
  );
  const totalDlq = data.queues.reduce((sum, q) => sum + q.dlqCount, 0);

  return (
    <VStack align="stretch" gap={5} width="full">
      <ActiveOperationsSection data={data} />

      <SimpleGrid columns={{ base: 2, md: 4, lg: 7 }} gap={1}>
        <LinkedStat
          label="Staged/s"
          value={formatRate(data.throughputIngestedPerSec)}
          sublabel={`peak ${formatRate(data.peakIngestedPerSec)}`}
        />
        <LinkedStat
          label="Completed/s"
          value={formatRate(data.completedPerSec)}
          sublabel={`${formatCount(data.totalCompleted)} total`}
        />
        <LinkedStat
          label="Failed/s"
          value={formatRate(data.failedPerSec)}
          sublabel={data.totalFailed > 0 ? `${formatCount(data.totalFailed)} total` : undefined}
          color={data.failedPerSec > 0 ? "red.500" : undefined}
        />
        <LinkedStat
          label="Blocked"
          value={totalBlocked.toString()}
          sublabel={`${data.totalGroups} groups`}
          href="/ops/queues"
          color={totalBlocked > 0 ? "red.500" : undefined}
        />
        <LinkedStat
          label="P50"
          value={formatMs(data.latencyP50Ms)}
          sublabel={`peak ${formatMs(data.peakLatencyP50Ms)}`}
        />
        <LinkedStat
          label="P99"
          value={formatMs(data.latencyP99Ms)}
          sublabel={`peak ${formatMs(data.peakLatencyP99Ms)}`}
        />
        <LinkedStat
          label="DLQ"
          value={totalDlq.toString()}
          sublabel={data.redisMemoryUsed}
          href="/ops/queues"
          color={totalDlq > 0 ? "orange.500" : undefined}
        />
      </SimpleGrid>

      <Card.Root overflow="hidden">
        <Card.Body padding={4}>
          <Text
            textStyle="xs"
            fontWeight="medium"
            color="fg.muted"
            marginBottom={2}
          >
            Throughput
          </Text>
          <ThroughputChart data={data} />
        </Card.Body>
      </Card.Root>

      <Card.Root overflow="hidden">
        <NextLink href="/ops/queues" style={{ textDecoration: "none" }}>
          <HStack
            paddingX={4}
            paddingTop={3}
            paddingBottom={2}
            cursor="pointer"
            _hover={{ color: "orange.500" }}
            transition="color 0.1s"
          >
            <Text textStyle="xs" fontWeight="medium" color="fg.muted">
              Top Errors
            </Text>
            <ArrowUpRight size={10} />
          </HStack>
        </NextLink>
        {data.topErrors.length > 0 ? (
          <Table.ScrollArea>
            <Table.Root size="sm" variant="line" css={{ "& tr:last-child td": { borderBottom: "none" } }}>
              <Table.Header>
                <Table.Row>
                  <Table.ColumnHeader width="60px">Count</Table.ColumnHeader>
                  <Table.ColumnHeader>Error</Table.ColumnHeader>
                  <Table.ColumnHeader>Pipeline</Table.ColumnHeader>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {data.topErrors.slice(0, 5).map((err, i) => (
                  <Table.Row key={i}>
                    <Table.Cell>
                      <Text color="red.500" fontWeight="medium">
                        {err.count}
                      </Text>
                    </Table.Cell>
                    <Table.Cell>
                      <Text truncate maxWidth="400px">
                        {err.sampleMessage}
                      </Text>
                    </Table.Cell>
                    <Table.Cell color="fg.muted">
                      {err.pipelineName ?? "—"}
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Root>
          </Table.ScrollArea>
        ) : (
          <Box paddingX={4} paddingBottom={4}>
            <Text textStyle="xs" color="fg.muted">
              {totalBlocked > 0 ? "0 errors" : "No errors"}
            </Text>
          </Box>
        )}
      </Card.Root>

      <ReplayHistorySection />
    </VStack>
  );
}

export default function OpsPage() {
  const router = useRouter();
  const { hasAccess, isLoading } = useOpsPermission();

  useEffect(() => {
    if (!isLoading && !hasAccess) {
      void router.push("/");
    }
  }, [hasAccess, isLoading, router]);

  const { data: sseData, status } = useOpsSSE();
  const snapshot = api.ops.getDashboardSnapshot.useQuery(undefined, {
    enabled: !sseData,
    refetchInterval: sseData ? false : 5000,
  });

  const data = sseData ?? snapshot.data ?? null;

  if (isLoading || !hasAccess) return null;

  return (
    <DashboardLayout>
      <PageLayout.Header>
        <PageLayout.Heading>Ops Dashboard</PageLayout.Heading>
        <Spacer />
        <ConnectionStatusIndicator status={status} />
      </PageLayout.Header>
      <PageLayout.Container>
        {data ? (
          <OpsDashboardContent data={data} />
        ) : (
          <Center paddingY={20}>
            <EmptyState.Root>
              <EmptyState.Content>
                <EmptyState.Indicator>
                  <Spinner size="lg" />
                </EmptyState.Indicator>
                <EmptyState.Title>Loading metrics</EmptyState.Title>
                <EmptyState.Description>
                  Waiting for the first collection cycle...
                </EmptyState.Description>
              </EmptyState.Content>
            </EmptyState.Root>
          </Center>
        )}
      </PageLayout.Container>
    </DashboardLayout>
  );
}
