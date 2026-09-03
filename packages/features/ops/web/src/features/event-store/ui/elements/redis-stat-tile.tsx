import { HStack, Stat, Text, VStack } from "@chakra-ui/react";
import type { DashboardData } from "@langwatch/ops-contract";
import { formatBytes } from "../../../../model/ops-formatters";

// CloudWatch defaults for ElastiCache: 80% memory, 70% engine CPU. The goal is
// to surface Redis saturation before an operator has to open the AWS console.
const MEMORY_WARN_PERCENT = 80;
const CPU_WARN_PERCENT = 70;

type RedisData = Pick<
  DashboardData,
  | "redisMemoryUsedBytes"
  | "redisMemoryPeakBytes"
  | "redisMemoryMaxBytes"
  | "redisConnectedClients"
  | "redisEngineCpuPercent"
>;

/**
 * Redis memory, processor and connections as ONE tile.
 *
 * They were three, which is how a ten-column strip ended up with eleven tiles
 * and orphaned the last onto a row of its own. They are also one subject: an
 * operator reads them together or not at all.
 */
export function RedisStatTile({ data }: { data: RedisData }) {
  // Compute the raw ratio for threshold checks, round only for display, so
  // 79.95% does not round up to 80.0 and falsely trigger the warning.
  const memoryPercentRaw =
    data.redisMemoryMaxBytes > 0
      ? (data.redisMemoryUsedBytes / data.redisMemoryMaxBytes) * 100
      : null;

  const memoryWarning = memoryPercentRaw !== null && memoryPercentRaw >= MEMORY_WARN_PERCENT;
  const cpuWarning =
    data.redisEngineCpuPercent !== null && data.redisEngineCpuPercent >= CPU_WARN_PERCENT;

  const memoryCaption =
    memoryPercentRaw === null
      ? "memory"
      : `${Math.round(memoryPercentRaw * 10) / 10}% of ${formatBytes(data.redisMemoryMaxBytes)}`;

  return (
    <Stat.Root
      borderRadius="md"
      padding={2}
      data-testid="redis-stat-tile"
      data-warning={memoryWarning || cpuWarning ? "true" : "false"}
    >
      <Stat.Label whiteSpace="nowrap">Redis</Stat.Label>
      <HStack gap={4} align="baseline">
        <RedisFigure
          value={formatBytes(data.redisMemoryUsedBytes)}
          caption={memoryCaption}
          warning={memoryWarning}
          testId="redis-memory-stat"
        />
        <RedisFigure
          value={data.redisEngineCpuPercent === null ? "—" : `${data.redisEngineCpuPercent}%`}
          caption={data.redisEngineCpuPercent === null ? "sampling" : "processor"}
          warning={cpuWarning}
          testId="redis-engine-cpu-stat"
        />
        <RedisFigure
          value={data.redisConnectedClients.toString()}
          caption="connections"
          testId="redis-clients-stat"
        />
      </HStack>
    </Stat.Root>
  );
}

function RedisFigure({
  value,
  caption,
  warning,
  testId,
}: {
  value: string;
  caption: string;
  warning?: boolean;
  testId: string;
}) {
  return (
    <VStack gap={0} align="start">
      <Text
        textStyle="lg"
        fontWeight="semibold"
        color={warning ? "red.500" : undefined}
        whiteSpace="nowrap"
        data-testid={testId}
      >
        {value}
      </Text>
      <Text textStyle="xs" color="fg.muted" whiteSpace="nowrap">
        {caption}
      </Text>
    </VStack>
  );
}
