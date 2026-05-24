import { Card, HStack, SimpleGrid, Stat, Text } from "@chakra-ui/react";
import type { DashboardData } from "~/server/app-layer/ops/types";

// Color thresholds match CloudWatch's default alarms for ElastiCache. The
// goal is to make Redis saturation visible *before* an operator opens the AWS
// console — the 2026-05-21 incident pegged engine CPU at 100% for 5+ hours
// while /ops showed only a tiny memory string under DLQ.
const MEMORY_WARN_PERCENT = 80;
const CPU_WARN_PERCENT = 70;

export function RedisPressurePanel({
  data,
}: {
  data: Pick<
    DashboardData,
    | "redisMemoryUsed"
    | "redisMemoryPeak"
    | "redisMemoryUsedBytes"
    | "redisMemoryMaxBytes"
    | "redisConnectedClients"
    | "redisEngineCpuPercent"
  >;
}) {
  const memoryPercent =
    data.redisMemoryMaxBytes > 0
      ? Math.round(
          (data.redisMemoryUsedBytes / data.redisMemoryMaxBytes) * 100 * 10,
        ) / 10
      : null;
  const maxMemoryHuman =
    data.redisMemoryMaxBytes > 0 ? humanBytes(data.redisMemoryMaxBytes) : null;

  const memoryWarning =
    memoryPercent !== null && memoryPercent >= MEMORY_WARN_PERCENT;
  const cpuWarning =
    data.redisEngineCpuPercent !== null &&
    data.redisEngineCpuPercent >= CPU_WARN_PERCENT;

  return (
    <Card.Root overflow="hidden">
      <Card.Body padding={4}>
        <HStack justifyContent="space-between" marginBottom={3}>
          <Text textStyle="xs" fontWeight="medium" color="fg.muted">
            Redis pressure
          </Text>
        </HStack>

        <SimpleGrid columns={{ base: 1, md: 3 }} gap={4}>
          <Stat.Root
            data-testid="redis-memory-stat"
            data-warning={memoryWarning ? "true" : "false"}
          >
            <Stat.Label>Memory</Stat.Label>
            <HStack gap={1.5} alignItems="baseline">
              <Stat.ValueText color={memoryWarning ? "red.500" : undefined}>
                {maxMemoryHuman
                  ? `${data.redisMemoryUsed} / ${maxMemoryHuman}`
                  : data.redisMemoryUsed}
              </Stat.ValueText>
              {memoryPercent !== null && (
                <Text
                  textStyle="xs"
                  color={memoryWarning ? "red.500" : "fg.muted"}
                  fontWeight="normal"
                  data-testid="redis-memory-percent"
                  data-warning={memoryWarning ? "true" : "false"}
                >
                  {memoryPercent}%
                </Text>
              )}
            </HStack>
            <Text textStyle="xs" color="fg.muted">
              peak {data.redisMemoryPeak}
            </Text>
          </Stat.Root>

          <Stat.Root
            data-testid="redis-engine-cpu-stat"
            data-warning={cpuWarning ? "true" : "false"}
          >
            <Stat.Label>Engine CPU</Stat.Label>
            <HStack gap={1.5} alignItems="baseline">
              <Stat.ValueText color={cpuWarning ? "red.500" : undefined}>
                {data.redisEngineCpuPercent === null
                  ? "-"
                  : `${data.redisEngineCpuPercent}%`}
              </Stat.ValueText>
              {data.redisEngineCpuPercent === null && (
                <Text textStyle="xs" color="fg.muted" fontWeight="normal">
                  sampling…
                </Text>
              )}
            </HStack>
            <Text textStyle="xs" color="fg.muted">
              main-thread (single-threaded)
            </Text>
          </Stat.Root>

          <Stat.Root data-testid="redis-clients-stat">
            <Stat.Label>Connections</Stat.Label>
            <HStack gap={1.5} alignItems="baseline">
              <Stat.ValueText>{data.redisConnectedClients}</Stat.ValueText>
              <Text textStyle="xs" color="fg.muted" fontWeight="normal">
                clients
              </Text>
            </HStack>
            <Text textStyle="xs" color="fg.muted">
              workers + dispatchers
            </Text>
          </Stat.Root>
        </SimpleGrid>
      </Card.Body>
    </Card.Root>
  );
}

function humanBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)}G`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(2)}M`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(2)}K`;
  return `${bytes}B`;
}
