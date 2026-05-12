import { useMemo, useRef, useState } from "react";
import { Box, Button, Center, HStack, Spinner, Text, VStack } from "@chakra-ui/react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DashboardData } from "~/server/app-layer/ops/types";

const COLORS = {
  staged: { stroke: "#06b6d4", fill: "#06b6d4" },
  completed: { stroke: "#22c55e", fill: "#22c55e" },
  failed: { stroke: "#ef4444", fill: "#ef4444" },
  pending: "#a78bfa",
  blocked: "#f97316",
};

interface ChartPoint {
  timestamp: number;
  staged: number;
  completed: number;
  failed: number;
  pending: number;
  blocked: number;
}

const BUCKET_OPTIONS = [
  { label: "2s", ms: 0 },
  { label: "5s", ms: 5_000 },
  { label: "15s", ms: 15_000 },
  { label: "30s", ms: 30_000 },
  { label: "1m", ms: 60_000 },
];

/** Downsample raw 2s points into averaged buckets. bucketMs=0 means raw. */
function downsample(
  raw: DashboardData["throughputHistory"],
  bucketMs: number,
): ChartPoint[] {
  if (raw.length === 0) return [];

  // Raw mode — no aggregation
  if (bucketMs <= 0) {
    return raw.map((point) => ({
      timestamp: point.timestamp,
      staged: point.ingestedPerSec,
      completed: point.completedPerSec,
      failed: point.failedPerSec,
      pending: point.pendingCount,
      blocked: point.blockedCount,
    }));
  }

  const buckets = new Map<
    number,
    { sum: ChartPoint; count: number }
  >();

  for (const point of raw) {
    const bucketKey =
      Math.floor(point.timestamp / bucketMs) * bucketMs;
    const existing = buckets.get(bucketKey);
    if (existing) {
      existing.sum.staged += point.ingestedPerSec;
      existing.sum.completed += point.completedPerSec;
      existing.sum.failed += point.failedPerSec;
      existing.sum.pending += point.pendingCount;
      existing.sum.blocked += point.blockedCount;
      existing.count++;
    } else {
      buckets.set(bucketKey, {
        sum: {
          timestamp: bucketKey,
          staged: point.ingestedPerSec,
          completed: point.completedPerSec,
          failed: point.failedPerSec,
          pending: point.pendingCount,
          blocked: point.blockedCount,
        },
        count: 1,
      });
    }
  }

  const result: ChartPoint[] = [];
  for (const [, { sum, count }] of buckets) {
    result.push({
      timestamp: sum.timestamp,
      staged: sum.staged / count,
      completed: sum.completed / count,
      failed: sum.failed / count,
      pending: Math.round(sum.pending / count),
      blocked: Math.round(sum.blocked / count),
    });
  }

  result.sort((a, b) => a.timestamp - b.timestamp);
  return result;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTimeWithSeconds(ts: number): string {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatAxisValue(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (v === 0) return "0";
  if (Number.isInteger(v)) return v.toString();
  return v.toFixed(1);
}

/** Build evenly-spaced tick values at clean minute intervals */
function computeTimeTicks(data: ChartPoint[]): number[] {
  if (data.length < 2) return [];
  const first = data[0]!.timestamp;
  const last = data[data.length - 1]!.timestamp;
  const range = last - first;

  let intervalMs = 60_000;
  if (range > 20 * 60_000) intervalMs = 5 * 60_000;
  else if (range > 10 * 60_000) intervalMs = 2 * 60_000;

  const firstAligned = Math.ceil(first / intervalMs) * intervalMs;
  const ticks: number[] = [];
  for (let t = firstAligned; t <= last; t += intervalMs) {
    ticks.push(t);
  }
  return ticks;
}

/** Round up to a "nice" axis max (1, 2, 5, 10, 20, 50, ...) */
function niceMax(raw: number): number {
  if (raw <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const normalized = raw / magnitude;
  let nice: number;
  if (normalized <= 1) nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 5) nice = 5;
  else nice = 10;
  return nice * magnitude;
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: number;
}) {
  if (!active || !payload?.length || label == null) return null;

  const rates = payload.filter(
    (p) => p.name !== "Pending" && p.name !== "Blocked",
  );
  const counts = payload.filter(
    (p) => p.name === "Pending" || p.name === "Blocked",
  );

  return (
    <Box
      bg="bg.panel"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      padding={2}
      shadow="md"
      minWidth="140px"
    >
      <Text textStyle="xs" color="fg.muted" marginBottom={1}>
        {formatTimeWithSeconds(label)}
      </Text>
      {rates.map((entry) => (
        <HStack key={entry.name} justify="space-between" gap={3}>
          <HStack gap={1.5}>
            <Box
              width="6px"
              height="6px"
              borderRadius="full"
              bg={entry.color}
            />
            <Text textStyle="xs">{entry.name}</Text>
          </HStack>
          <Text textStyle="xs" fontFamily="mono" fontWeight="medium">
            {entry.value.toFixed(1)}/s
          </Text>
        </HStack>
      ))}
      {counts.length > 0 && counts.some((c) => c.value > 0) && (
        <>
          <Box height="1px" bg="border" marginY={1} />
          {counts.map((entry) => (
            <HStack key={entry.name} justify="space-between" gap={3}>
              <HStack gap={1.5}>
                <Box width="6px" height="2px" bg={entry.color} />
                <Text textStyle="xs">{entry.name}</Text>
              </HStack>
              <Text textStyle="xs" fontFamily="mono">
                {entry.value.toLocaleString()}
              </Text>
            </HStack>
          ))}
        </>
      )}
    </Box>
  );
}

function CustomLegend({ showCounts }: { showCounts: boolean }) {
  const items = [
    { name: "Staged/s", color: COLORS.staged.stroke, type: "area" as const },
    {
      name: "Completed/s",
      color: COLORS.completed.stroke,
      type: "area" as const,
    },
    { name: "Failed/s", color: COLORS.failed.stroke, type: "area" as const },
    ...(showCounts
      ? [
          { name: "Pending", color: COLORS.pending, type: "line" as const },
          { name: "Blocked", color: COLORS.blocked, type: "line" as const },
        ]
      : []),
  ];

  return (
    <HStack gap={3} justify="center" paddingTop={2}>
      {items.map((item) => (
        <HStack key={item.name} gap={1}>
          {item.type === "area" ? (
            <Box
              width="6px"
              height="6px"
              borderRadius="full"
              bg={item.color}
            />
          ) : (
            <Box
              width="10px"
              height="2px"
              bg={item.color}
              borderRadius="full"
              opacity={0.7}
            />
          )}
          <Text textStyle="xs" color="fg.muted">
            {item.name}
          </Text>
        </HStack>
      ))}
    </HStack>
  );
}

export function ThroughputChart({ data }: { data: DashboardData }) {
  const stableYMaxRef = useRef(1);
  const [bucketMs, setBucketMs] = useState(5_000);

  const chartData = useMemo(
    () => downsample(data.throughputHistory, bucketMs),
    [data.throughputHistory, bucketMs],
  );

  const timeTicks = useMemo(() => computeTimeTicks(chartData), [chartData]);

  const yMax = useMemo(() => {
    if (chartData.length === 0) return 1;
    let max = 0;
    for (const p of chartData) {
      max = Math.max(max, p.staged, p.completed, p.failed);
    }
    // Use niceMax for clean axis values, with 30% headroom
    const target = niceMax(max * 1.3);
    // Only update if the new target is significantly different (avoid jitter)
    if (
      target > stableYMaxRef.current * 1.2 ||
      target < stableYMaxRef.current * 0.5
    ) {
      stableYMaxRef.current = target;
    }
    return stableYMaxRef.current;
  }, [chartData]);

  const hasCountData = useMemo(() => {
    return chartData.some((p) => p.pending > 0 || p.blocked > 0);
  }, [chartData]);

  const yMaxRight = useMemo(() => {
    if (!hasCountData) return 10;
    let max = 0;
    for (const p of chartData) {
      max = Math.max(max, p.pending, p.blocked);
    }
    return max <= 0 ? 10 : niceMax(max * 1.3);
  }, [chartData, hasCountData]);

  if (chartData.length < 2) {
    return (
      <Center height="280px">
        <VStack gap={2}>
          <Spinner size="sm" />
          <Text textStyle="xs" color="fg.muted">
            Collecting data...
          </Text>
        </VStack>
      </Center>
    );
  }

  return (
    <VStack align="stretch" gap={0}>
      <HStack justify="space-between" paddingX={1} paddingBottom={1}>
        <Text textStyle="xs" color="fg.muted" fontStyle="italic">
          events/s
        </Text>
        <HStack gap={0.5}>
          {BUCKET_OPTIONS.map((opt) => (
            <Button
              key={opt.ms}
              size="2xs"
              variant={bucketMs === opt.ms ? "subtle" : "ghost"}
              colorPalette={bucketMs === opt.ms ? "orange" : "gray"}
              onClick={() => setBucketMs(opt.ms)}
              fontFamily="mono"
              minWidth="auto"
              paddingX={1.5}
            >
              {opt.label}
            </Button>
          ))}
        </HStack>
        {hasCountData && (
          <Text textStyle="xs" color="fg.muted" fontStyle="italic">
            count
          </Text>
        )}
      </HStack>
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart
          data={chartData}
          margin={{ top: 8, right: hasCountData ? 4 : 12, bottom: 4, left: -8 }}
        >
          <defs>
            <linearGradient id="gradStaged" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.staged.fill} stopOpacity={0.2} />
              <stop offset="100%" stopColor={COLORS.staged.fill} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gradCompleted" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.completed.fill} stopOpacity={0.2} />
              <stop offset="100%" stopColor={COLORS.completed.fill} stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="gradFailed" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COLORS.failed.fill} stopOpacity={0.25} />
              <stop offset="100%" stopColor={COLORS.failed.fill} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="var(--chakra-colors-border)"
            strokeOpacity={0.4}
            vertical={false}
          />
          <XAxis
            dataKey="timestamp"
            type="number"
            domain={["dataMin", "dataMax"]}
            scale="time"
            ticks={timeTicks}
            tickFormatter={formatTime}
            tick={{ fontSize: 10, fill: "var(--chakra-colors-fg-muted)" }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            yAxisId="rate"
            tick={{ fontSize: 10, fill: "var(--chakra-colors-fg-muted)" }}
            axisLine={false}
            tickLine={false}
            width={40}
            domain={[0, yMax]}
            allowDataOverflow
            tickFormatter={formatAxisValue}
          />
          {hasCountData && (
            <YAxis
              yAxisId="count"
              orientation="right"
              tick={{ fontSize: 10, fill: "var(--chakra-colors-fg-muted)" }}
              axisLine={false}
              tickLine={false}
              width={40}
              domain={[0, yMaxRight]}
              allowDataOverflow
              tickFormatter={formatAxisValue}
            />
          )}
          <Tooltip
            content={<CustomTooltip />}
            cursor={{
              stroke: "var(--chakra-colors-fg-muted)",
              strokeWidth: 1,
              strokeDasharray: "3 3",
              strokeOpacity: 0.3,
            }}
          />
          <Area
            yAxisId="rate"
            type="monotone"
            dataKey="staged"
            stroke={COLORS.staged.stroke}
            fill="url(#gradStaged)"
            strokeWidth={1.5}
            name="Staged/s"
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
          <Area
            yAxisId="rate"
            type="monotone"
            dataKey="completed"
            stroke={COLORS.completed.stroke}
            fill="url(#gradCompleted)"
            strokeWidth={1.5}
            name="Completed/s"
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
          <Area
            yAxisId="rate"
            type="monotone"
            dataKey="failed"
            stroke={COLORS.failed.stroke}
            fill="url(#gradFailed)"
            strokeWidth={1.5}
            name="Failed/s"
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 3, strokeWidth: 0 }}
          />
          <Line
            yAxisId={hasCountData ? "count" : "rate"}
            type="monotone"
            dataKey="pending"
            stroke={COLORS.pending}
            strokeWidth={1}
            strokeOpacity={0.6}
            strokeDasharray="4 3"
            dot={false}
            activeDot={{ r: 2, strokeWidth: 0 }}
            name="Pending"
            isAnimationActive={false}
          />
          <Line
            yAxisId={hasCountData ? "count" : "rate"}
            type="monotone"
            dataKey="blocked"
            stroke={COLORS.blocked}
            strokeWidth={1}
            strokeOpacity={0.6}
            strokeDasharray="4 3"
            dot={false}
            activeDot={{ r: 2, strokeWidth: 0 }}
            name="Blocked"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      <CustomLegend showCounts={hasCountData} />
    </VStack>
  );
}
