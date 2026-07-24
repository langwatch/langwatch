import { HStack, Text, VStack } from "@chakra-ui/react";
import type { ScenarioResults } from "~/server/scenarios/schemas";
import { CONSOLE_COLORS } from "./constants";

interface MetricsSummaryProps {
  results?: ScenarioResults | null;
  durationInMs?: number;
}

/**
 * Metrics summary component
 * Single Responsibility: Displays scenario metrics including success criteria, rate, and duration
 */
export function MetricsSummary({ results, durationInMs }: MetricsSummaryProps) {
  const metCount = results?.metCriteria?.length || 0;
  const unmetCount = results?.unmetCriteria?.length || 0;
  const totalCriteria = metCount + unmetCount;
  const successRate =
    totalCriteria > 0 ? ((metCount / totalCriteria) * 100).toFixed(1) : "0.0";
  const duration = durationInMs ? (durationInMs / 1000).toFixed(2) : "0.00";

  return (
    <VStack align="start" gap={1} mb={3}>
      <HStack>
        <Text color="white">Success Criteria:</Text>
        <Text
          color={
            metCount > 0
              ? CONSOLE_COLORS.successColor
              : CONSOLE_COLORS.failureColor
          }
        >
          {metCount}/{totalCriteria}
        </Text>
      </HStack>
      <HStack>
        <Text color="white">Success Rate:</Text>
        <Text
          color={
            parseFloat(successRate) > 50
              ? CONSOLE_COLORS.successColor
              : CONSOLE_COLORS.failureColor
          }
        >
          {successRate}%
        </Text>
      </HStack>
      <HStack>
        <Text color="white">Duration:</Text>
        <Text color={CONSOLE_COLORS.consoleText}>{duration}s</Text>
      </HStack>
    </VStack>
  );
}
