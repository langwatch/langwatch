import { SimpleGrid, Box, Text, Stat, StatLabel, StatNumber, Heading, HStack, VStack } from "@chakra-ui/react";
import type { DashboardData, PhaseMetrics, QueueInfo } from "../../../shared/types.ts";
import { formatNumber, formatLatency, formatRate } from "../../utils/formatters.ts";

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

const EMPTY_PHASE: PhaseMetrics = { pending: 0, active: 0, completedPerSec: 0, failedPerSec: 0, latencyP50Ms: 0, latencyP99Ms: 0, peakCompletedPerSec: 0, peakFailedPerSec: 0, peakLatencyP50Ms: 0, peakLatencyP99Ms: 0 };

function PhaseCard({ title, metrics }: { title: string; metrics: PhaseMetrics }) {
  return (
    <Box flex="1" minW="160px">
      <Heading
        size="xs"
        fontSize="10px"
        color="#4a6a7a"
        textTransform="uppercase"
        letterSpacing="0.15em"
        mb={2}
      >
        {title}
      </Heading>
      <VStack spacing={2} align="stretch">
        <Box
          bg="#0a0e17"
          px={3}
          py={2}
          borderRadius="2px"
          border="1px solid"
          borderColor="rgba(0, 240, 255, 0.15)"
        >
          <HStack justify="space-between">
            <Box>
              <Text fontSize="9px" color="#4a6a7a" textTransform="uppercase" letterSpacing="0.1em">Pending</Text>
              <Text fontSize="md" color="#00f0ff" sx={{ fontVariantNumeric: "tabular-nums" }}>
                {formatNumber(metrics.pending)}
              </Text>
            </Box>
            <Box textAlign="right">
              <Text fontSize="9px" color="#4a6a7a" textTransform="uppercase" letterSpacing="0.1em">Active</Text>
              <Text fontSize="md" color={metrics.active > 0 ? "#00ff41" : "#4a6a7a"} sx={{ fontVariantNumeric: "tabular-nums" }}>
                {metrics.active}
              </Text>
            </Box>
          </HStack>
        </Box>
        <Box
          bg="#0a0e17"
          px={3}
          py={2}
          borderRadius="2px"
          border="1px solid"
          borderColor="rgba(0, 240, 255, 0.15)"
        >
          <HStack justify="space-between">
            <Box>
              <Text fontSize="9px" color="#4a6a7a" textTransform="uppercase" letterSpacing="0.1em">Done/s</Text>
              <ValueWithPeak
                value={formatRate(metrics.completedPerSec)}
                peak={formatRate(metrics.peakCompletedPerSec)}
                color={metrics.completedPerSec > 0 ? "#00ff41" : "#4a6a7a"}
              />
            </Box>
            <Box textAlign="center">
              <Text fontSize="9px" color="#4a6a7a" textTransform="uppercase" letterSpacing="0.1em">p50 / p99</Text>
              <Text fontSize="md" color={metrics.latencyP50Ms > 0 ? "#00f0ff" : "#4a6a7a"} sx={{ fontVariantNumeric: "tabular-nums" }}>
                {formatLatency(metrics.latencyP50Ms)}
                <Text as="span" fontSize="xs" color="#4a6a7a"> / {formatLatency(metrics.latencyP99Ms)}</Text>
                {metrics.peakLatencyP50Ms > 0 && metrics.peakLatencyP50Ms > metrics.latencyP50Ms && (
                  <Text as="span" fontSize="9px" color="#4a6a7a" ml={1}>
                    pk {formatLatency(metrics.peakLatencyP50Ms)}
                  </Text>
                )}
              </Text>
            </Box>
            <Box textAlign="right">
              <Text fontSize="9px" color="#4a6a7a" textTransform="uppercase" letterSpacing="0.1em">Failed/s</Text>
              <ValueWithPeak
                value={formatRate(metrics.failedPerSec)}
                peak={formatRate(metrics.peakFailedPerSec)}
                color={metrics.failedPerSec > 0 ? "#ff0033" : "#4a6a7a"}
              />
            </Box>
          </HStack>
        </Box>
      </VStack>
    </Box>
  );
}

export function StatCards({ data, queues }: { data: DashboardData; queues?: QueueInfo[] }) {
  // Derive group counts from queues prop (which includes draining groups) when available,
  // so stat cards stay in sync with the groups table below.
  let totalGroups = data.totalGroups;
  let blockedGroups = data.blockedGroups;
  let totalPendingJobs = data.totalPendingJobs;
  if (queues && queues.length > 0) {
    totalGroups = 0;
    blockedGroups = 0;
    totalPendingJobs = 0;
    for (const q of queues) {
      totalGroups += q.groups.length;
      blockedGroups += q.blockedGroupCount;
      totalPendingJobs += q.totalPendingJobs;
    }
  }

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

  const phases = data.phases;

  return (
    <Box mb={6}>
      <SimpleGrid columns={{ base: 2, md: 5 }} spacing={3} mb={4}>
        <StatCard label="Done/s" color={data.completedPerSec > 0 ? "#00ff41" : "#4a6a7a"}>
          <ValueWithPeak
            value={formatRate(data.completedPerSec)}
            peak={formatRate(data.peakCompletedPerSec)}
            color={data.completedPerSec > 0 ? "#00ff41" : "#4a6a7a"}
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
        <StatCard label="Failed/s" color={data.failedPerSec > 0 ? "#ff0033" : "#4a6a7a"}>
          <ValueWithPeak
            value={formatRate(data.failedPerSec)}
            peak={formatRate(data.peakFailedPerSec)}
            color={data.failedPerSec > 0 ? "#ff0033" : "#4a6a7a"}
          />
        </StatCard>
        <StatCard label="Staged/s" color={data.throughputStagedPerSec > 0 ? "#00f0ff" : "#4a6a7a"}>
          <ValueWithPeak
            value={formatRate(data.throughputStagedPerSec)}
            peak={formatRate(data.peakStagedPerSec)}
            color={data.throughputStagedPerSec > 0 ? "#00f0ff" : "#4a6a7a"}
          />
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
      </SimpleGrid>

      <HStack spacing={4} align="start">
        <PhaseCard title="Commands" metrics={phases?.commands ?? EMPTY_PHASE} />
        <PhaseCard title="Projections" metrics={phases?.projections ?? EMPTY_PHASE} />
        <PhaseCard title="Reactions" metrics={phases?.reactions ?? EMPTY_PHASE} />
      </HStack>
    </Box>
  );
}
