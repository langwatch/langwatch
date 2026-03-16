import { SimpleGrid, Box, Text, Stat, StatLabel, StatNumber } from "@chakra-ui/react";
import { TriangleUpIcon, TriangleDownIcon } from "@chakra-ui/icons";
import type { DashboardData } from "../../../shared/types.ts";
import { formatLatency, formatRate, formatEta } from "../../utils/formatters.ts";

/** Interpolate hue from 120 (green) → 0 (red) based on fill ratio 0–1 */
function fillColor(ratio: number): string {
  const clamped = Math.max(0, Math.min(1, ratio));
  if (clamped < 0.5) return "#00f0ff";
  if (clamped < 0.75) return "#ffaa00";
  return "#ff0033";
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** Show a value with its peak in muted smaller text */
function ValueWithPeak({ value, peak, color, format }: {
  value: string;
  peak: string;
  color: string;
  format?: "rate" | "latency";
}) {
  const showPeak = peak !== value && peak !== "—" && peak !== "0/s";
  return (
    <Text fontSize="md" color={color} sx={{ fontVariantNumeric: "tabular-nums" }}>
      {value}
      {showPeak && (
        <Text as="span" fontSize="9px" color="#4a6a7a" ml={1}>
          pk {peak}
        </Text>
      )}
    </Text>
  );
}

interface GaugeBarProps {
  ratio: number;
  label: string;
}

function GaugeBar({ ratio, label }: GaugeBarProps) {
  const clamped = Math.max(0, Math.min(1, ratio));

  return (
    <Box mt={1.5}>
      <Box h="4px" borderRadius="1px" bg="rgba(0, 240, 255, 0.1)" overflow="hidden">
        <Box
          h="100%"
          borderRadius="1px"
          bg={fillColor(clamped)}
          w={`${clamped * 100}%`}
          transition="width 0.5s, background-color 0.5s"
          boxShadow={`0 0 6px ${fillColor(clamped)}`}
        />
      </Box>
      <Text fontSize="9px" color="text.muted" mt={0.5}>{label}</Text>
    </Box>
  );
}

function StatCard({ label, children, color, gauge }: {
  label: string;
  children: React.ReactNode;
  color: string;
  gauge?: { ratio: number; label: string };
}) {
  return (
    <Box
      bg="#0a0e17"
      px={3}
      py={2}
      borderRadius="2px"
      border="1px solid"
      borderColor="rgba(0, 240, 255, 0.2)"
      boxShadow="0 0 8px rgba(0, 240, 255, 0.08)"
      position="relative"
      _before={{
        content: '""',
        position: "absolute",
        top: "4px",
        left: "0",
        width: "3px",
        height: "calc(100% - 8px)",
        bg: "rgba(0, 240, 255, 0.3)",
      }}
    >
      <Stat size="sm">
        <StatLabel
          fontSize="9px"
          color="#4a6a7a"
          textTransform="uppercase"
          letterSpacing="0.1em"
        >
          {label}
        </StatLabel>
        <StatNumber
          fontSize="lg"
          color={color}
          sx={{ fontVariantNumeric: "tabular-nums" }}
          textShadow={`0 0 10px ${color}40`}
        >
          {children}
        </StatNumber>
      </Stat>
      {gauge && <GaugeBar ratio={gauge.ratio} label={gauge.label} />}
    </Box>
  );
}

function BacklogTrend({ history }: { history: DashboardData["throughputHistory"] }) {
  if (history.length < 16) return null;
  const recent = history[history.length - 1];
  const older = history[history.length - 16]; // ~30s ago at 2s intervals
  if (!recent || !older || recent.pendingCount === undefined || older.pendingCount === undefined) return null;

  const diff = recent.pendingCount - older.pendingCount;
  if (diff === 0) return null;

  return diff > 0 ? (
    <TriangleUpIcon color="#ff0033" boxSize="10px" ml={1} />
  ) : (
    <TriangleDownIcon color="#00ff41" boxSize="10px" ml={1} />
  );
}

export function StatCards({ data }: { data: DashboardData }) {
  const hasMaxMemory = data.redisMemoryMaxBytes > 0;
  const peakBytes = data.redisMemoryPeakBytes ?? 0;
  const redisCeiling = hasMaxMemory
    ? data.redisMemoryMaxBytes
    : peakBytes > 0
      ? peakBytes
      : data.redisMemoryUsedBytes;
  const redisMemRatio = redisCeiling > 0
    ? data.redisMemoryUsedBytes / redisCeiling
    : 0;

  return (
    <Box mb={6}>
      <SimpleGrid columns={{ base: 2, md: 4 }} spacing={3}>
        <StatCard label="Done/s" color={data.completedPerSec > 0 ? "#00ff41" : "#4a6a7a"}>
          <ValueWithPeak
            value={formatRate(data.completedPerSec)}
            peak={formatRate(data.peakCompletedPerSec)}
            color={data.completedPerSec > 0 ? "#00ff41" : "#4a6a7a"}
          />
        </StatCard>
        <StatCard label="Failed/s" color={data.failedPerSec > 0 ? "#ff0033" : "#4a6a7a"}>
          <ValueWithPeak
            value={formatRate(data.failedPerSec)}
            peak={formatRate(data.peakFailedPerSec)}
            color={data.failedPerSec > 0 ? "#ff0033" : "#4a6a7a"}
          />
        </StatCard>
        <StatCard label="Latency p50 / p99" color={data.latencyP50Ms > 0 ? "#00f0ff" : "#4a6a7a"}>
          <Text as="span">{formatLatency(data.latencyP50Ms)}</Text>
          <Text as="span" fontSize="xs" color="#4a6a7a"> / {formatLatency(data.latencyP99Ms)}</Text>
          {data.peakLatencyP50Ms > 0 && data.peakLatencyP50Ms > data.latencyP50Ms && (
            <Text as="span" fontSize="9px" color="#4a6a7a" ml={1}>
              pk {formatLatency(data.peakLatencyP50Ms)}
            </Text>
          )}
        </StatCard>
        <StatCard label="Staged/s" color={data.throughputStagedPerSec > 0 ? "#00f0ff" : "#4a6a7a"}>
          <ValueWithPeak
            value={formatRate(data.throughputStagedPerSec)}
            peak={formatRate(data.peakStagedPerSec)}
            color={data.throughputStagedPerSec > 0 ? "#00f0ff" : "#4a6a7a"}
          />
        </StatCard>
      </SimpleGrid>
      <SimpleGrid columns={{ base: 2, md: 4 }} spacing={3} mt={3}>
        <StatCard label="Total Completed" color={data.totalCompleted > 0 ? "#00ff41" : "#4a6a7a"}>
          {data.totalCompleted.toLocaleString()}
        </StatCard>
        <StatCard label="Total Failed" color={data.totalFailed > 0 ? "#ff0033" : "#4a6a7a"}>
          {data.totalFailed.toLocaleString()}
        </StatCard>
        <StatCard
          label="Redis Memory"
          color={hasMaxMemory ? fillColor(redisMemRatio) : "#ffaa00"}
          gauge={{
            ratio: redisMemRatio,
            label: hasMaxMemory
              ? `${formatBytes(data.redisMemoryUsedBytes)} / ${formatBytes(data.redisMemoryMaxBytes)}`
              : peakBytes > 0
                ? `${formatBytes(data.redisMemoryUsedBytes)} / ${formatBytes(peakBytes)} (peak)`
                : formatBytes(data.redisMemoryUsedBytes),
          }}
        >
          {data.redisMemoryUsed}
        </StatCard>
        <StatCard
          label="ETA to Drain"
          color={
            data.completedPerSec <= 0
              ? "#4a6a7a"
              : (data.totalPendingJobs / data.completedPerSec) * 1000 < 300_000
                ? "#00ff41"
                : (data.totalPendingJobs / data.completedPerSec) * 1000 < 1_800_000
                  ? "#ffaa00"
                  : "#ff0033"
          }
        >
          {formatEta(data.totalPendingJobs, data.completedPerSec)}
          <BacklogTrend history={data.throughputHistory} />
        </StatCard>
      </SimpleGrid>
    </Box>
  );
}
