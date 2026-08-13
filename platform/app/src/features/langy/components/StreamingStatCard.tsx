import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import type { LangyTurnMetric } from "../hooks/useLangyTurnSignals";
import { NumberTicker } from "./NumberTicker";

/**
 * Compact metrics card for a live turn — e.g. "1,204 traces · 94% pass rate".
 * Each value spring-rolls up from 0 in a tabular-nums monospace so the digits
 * don't jitter as they climb. Renders nothing when the turn reports no metrics
 * (the clean seam until the PR3 metric transport lands). Static under
 * `prefers-reduced-motion` — NumberTicker shows the final value.
 */
export function StreamingStatCard({ metrics }: { metrics: LangyTurnMetric[] }) {
  if (metrics.length === 0) return null;

  return (
    <HStack
      gap={6}
      alignSelf="stretch"
      borderWidth="1px"
      borderStyle="solid"
      borderColor="border.muted"
      borderRadius="13px"
      background="bg.subtle"
      paddingX="15px"
      paddingY="13px"
    >
      {metrics.map((metric, index) => (
        <VStack key={`${metric.label}-${index}`} align="start" gap={0.5}>
          <Box
            fontFamily="mono"
            fontVariantNumeric="tabular-nums"
            textStyle="xl"
            fontWeight="700"
            letterSpacing="-0.03em"
            lineHeight="1.1"
            color="fg"
          >
            <NumberTicker
              value={metric.value}
              format={
                metric.format ??
                (metric.suffix
                  ? (n) => `${n.toLocaleString()}${metric.suffix}`
                  : undefined)
              }
            />
          </Box>
          <Text textStyle="2xs" color="fg.muted">
            {metric.label}
          </Text>
        </VStack>
      ))}
    </HStack>
  );
}
