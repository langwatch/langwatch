import { useMemo, useRef } from "react";
import { Center, Spinner, Text, VStack } from "@chakra-ui/react";
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
import type { DashboardData } from "~/server/app-layer/ops/types";

interface ChartPoint {
  time: string;
  staged: number;
  completed: number;
  failed: number;
  pending: number;
  blocked: number;
}

export function ThroughputChart({ data }: { data: DashboardData }) {
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
