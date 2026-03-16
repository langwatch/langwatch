import { Box, Text, HStack, VStack } from "@chakra-ui/react";
import type { QueueInfo } from "../../../shared/types.ts";

const BUCKETS = [
  { label: "< 1m", maxMs: 60_000 },
  { label: "1-5m", maxMs: 300_000 },
  { label: "5-30m", maxMs: 1_800_000 },
  { label: "30m-1h", maxMs: 3_600_000 },
  { label: "1-6h", maxMs: 21_600_000 },
  { label: "6-24h", maxMs: 86_400_000 },
  { label: "> 24h", maxMs: Infinity },
] as const;

function bucketize(queues: QueueInfo[]): number[] {
  const now = Date.now();
  const counts = new Array(BUCKETS.length).fill(0) as number[];

  for (const q of queues) {
    for (const g of q.groups) {
      if (!g.oldestJobMs) continue;
      const ageMs = now - g.oldestJobMs;
      for (let i = 0; i < BUCKETS.length; i++) {
        if (ageMs < BUCKETS[i]!.maxMs || i === BUCKETS.length - 1) {
          counts[i]!++;
          break;
        }
      }
    }
  }
  return counts;
}

function BarRow({ label, count, maxCount }: { label: string; count: number; maxCount: number }) {
  const ratio = maxCount > 0 ? count / maxCount : 0;
  const color = ratio > 0.6 ? "#ff0033" : ratio > 0.3 ? "#ffaa00" : "#00f0ff";

  return (
    <HStack spacing={2} h="20px">
      <Text fontSize="9px" color="#4a6a7a" w="50px" textAlign="right" fontFamily="mono">
        {label}
      </Text>
      <Box flex="1" h="12px" bg="rgba(0, 240, 255, 0.05)" borderRadius="1px" overflow="hidden">
        <Box
          h="100%"
          bg={color}
          w={`${ratio * 100}%`}
          borderRadius="1px"
          transition="width 0.5s, background-color 0.5s"
          boxShadow={count > 0 ? `0 0 4px ${color}` : "none"}
          opacity={0.7}
        />
      </Box>
      <Text fontSize="10px" color={count > 0 ? "#b0c4d8" : "#4a6a7a"} w="35px" textAlign="right" fontFamily="mono" sx={{ fontVariantNumeric: "tabular-nums" }}>
        {count}
      </Text>
    </HStack>
  );
}

export function AgeHistogram({ queues }: { queues: QueueInfo[] }) {
  const counts = bucketize(queues);
  const maxCount = Math.max(...counts, 1);
  const total = counts.reduce((a, b) => a + b, 0);

  if (total === 0) return null;

  return (
    <Box
      bg="#0a0e17"
      p={4}
      borderRadius="2px"
      border="1px solid"
      borderColor="rgba(0, 240, 255, 0.15)"
      boxShadow="0 0 8px rgba(0, 240, 255, 0.08)"
    >
      <Text
        fontSize="xs"
        color="#00f0ff"
        fontWeight="600"
        textTransform="uppercase"
        letterSpacing="0.15em"
        mb={3}
      >
        // Job Age Distribution
      </Text>
      <VStack spacing={1} align="stretch">
        {BUCKETS.map((bucket, i) => (
          <BarRow key={bucket.label} label={bucket.label} count={counts[i]!} maxCount={maxCount} />
        ))}
      </VStack>
    </Box>
  );
}
