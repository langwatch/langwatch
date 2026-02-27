import { SimpleGrid, Box, Text, Stat, StatLabel, StatNumber } from "@chakra-ui/react";
import type { DashboardData } from "../../../shared/types.ts";
import { formatNumber } from "../../utils/formatters.ts";

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

  const cards: {
    label: string;
    value: string;
    color: string;
    gauge?: { ratio: number; label: string };
  }[] = [
    {
      label: "Total Groups",
      value: formatNumber(data.totalGroups),
      color: "#00f0ff",
    },
    {
      label: "Blocked Groups",
      value: formatNumber(data.blockedGroups),
      color: data.blockedGroups > 0 ? "#ff0033" : "#4a6a7a",
    },
    {
      label: "Pending Jobs",
      value: formatNumber(data.totalPendingJobs),
      color: "#00f0ff",
    },
    {
      label: "Staging/s",
      value: `${data.throughputStagedPerSec}/s`,
      color: "#00f0ff",
    },
    {
      label: "Completed/s",
      value: `${data.completedPerSec}/s`,
      color: "#00ff41",
    },
    {
      label: "Peak Staging/s",
      value: `${data.throughputHistory.length > 0 ? Math.max(...data.throughputHistory.map((p) => p.stagedPerSec)) : 0}/s`,
      color: "#ffaa00",
    },
    {
      label: "Failed/s",
      value: `${data.failedPerSec ?? 0}/s`,
      color: data.failedPerSec > 0 ? "#ff0033" : "#4a6a7a",
    },
    {
      label: "Redis Memory",
      value: data.redisMemoryUsed,
      color: hasMaxMemory ? fillColor(redisMemRatio) : "#ffaa00",
      gauge: {
        ratio: redisMemRatio,
        label: hasMaxMemory
          ? `${formatBytes(data.redisMemoryUsedBytes)} / ${formatBytes(data.redisMemoryMaxBytes)}`
          : peakBytes > 0
            ? `${formatBytes(data.redisMemoryUsedBytes)} / ${formatBytes(peakBytes)} (peak)`
            : formatBytes(data.redisMemoryUsedBytes),
      },
    },
  ];

  return (
    <SimpleGrid columns={{ base: 2, md: 4, lg: cards.length }} spacing={3} mb={6}>
      {cards.map((card) => (
        <Box
          key={card.label}
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
              {card.label}
            </StatLabel>
            <StatNumber
              fontSize="lg"
              color={card.color}
              sx={{ fontVariantNumeric: "tabular-nums" }}
              textShadow={`0 0 10px ${card.color}40`}
            >
              {card.value}
            </StatNumber>
          </Stat>
          {card.gauge && <GaugeBar ratio={card.gauge.ratio} label={card.gauge.label} />}
        </Box>
      ))}
    </SimpleGrid>
  );
}
