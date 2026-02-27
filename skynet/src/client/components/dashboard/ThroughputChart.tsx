import { Box, Text } from "@chakra-ui/react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { ThroughputPoint } from "../../../shared/types.ts";

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

export function ThroughputChart({ data }: { data: ThroughputPoint[] }) {
  const tickColor = "#4a6a7a";
  const tooltipBg = "#0a0e17";
  const tooltipBorder = "rgba(0, 240, 255, 0.3)";

  if (data.length < 2) {
    return (
      <Box bg="#0a0e17" p={4} borderRadius="2px" border="1px solid" borderColor="rgba(0, 240, 255, 0.15)" boxShadow="0 0 8px rgba(0, 240, 255, 0.08)" h="100%">
        <Text fontSize="sm" color="#4a6a7a" textTransform="uppercase" letterSpacing="0.1em">// THROUGHPUT — COLLECTING DATA...</Text>
      </Box>
    );
  }

  return (
    <Box bg="#0a0e17" p={4} borderRadius="2px" border="1px solid" borderColor="rgba(0, 240, 255, 0.15)" boxShadow="0 0 8px rgba(0, 240, 255, 0.08)" h="100%">
      <Text fontSize="xs" color="#00f0ff" mb={2} fontWeight="600" textTransform="uppercase" letterSpacing="0.15em">
        // Throughput
      </Text>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="stagedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#00f0ff" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#00f0ff" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="completedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#00ff41" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#00ff41" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="failedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#ff0033" stopOpacity={0.25} />
              <stop offset="95%" stopColor="#ff0033" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="timestamp"
            tickFormatter={formatTime}
            tick={{ fill: tickColor, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: tickColor, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: tooltipBg,
              border: `1px solid ${tooltipBorder}`,
              borderRadius: 2,
              fontSize: 12,
              color: "#00f0ff",
              boxShadow: "0 0 12px rgba(0, 240, 255, 0.15)",
            }}
            labelFormatter={formatTime}
          />
          <Legend
            wrapperStyle={{ fontSize: 10, color: "#4a6a7a" }}
            iconType="line"
          />
          <Area
            type="monotone"
            dataKey="stagedPerSec"
            name="Staged/s"
            stroke="#00f0ff"
            fill="url(#stagedGrad)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="completedPerSec"
            name="Completed/s"
            stroke="#00ff41"
            fill="url(#completedGrad)"
            strokeWidth={2}
          />
          <Area
            type="monotone"
            dataKey="failedPerSec"
            name="Failed/s"
            stroke="#ff0033"
            fill="url(#failedGrad)"
            strokeWidth={1.5}
          />
        </AreaChart>
      </ResponsiveContainer>
    </Box>
  );
}
