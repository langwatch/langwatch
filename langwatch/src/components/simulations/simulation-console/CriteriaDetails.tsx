import { Box, Text, VStack } from "@chakra-ui/react";
import type { ScenarioResults } from "~/server/scenarios/schemas";
import { CONSOLE_COLORS, REASONING_VERDICT_COLOR_MAP } from "./constants";

interface CriteriaDetailsProps {
  results?: ScenarioResults | null;
}

/**
 * Criteria details component
 * Single Responsibility: Displays met/unmet criteria and reasoning details
 */
export function CriteriaDetails({ results }: CriteriaDetailsProps) {
  if (!results) return null;

  return (
    <VStack align="start" gap={3} pl={4}>
      {/* Met Criteria */}
      {results.metCriteria && results.metCriteria.length > 0 && (
        <Box>
          <Text
            color={CONSOLE_COLORS.successColor}
            fontWeight="semibold"
            mb={1}
          >
            ✓ Met Criteria ({results.metCriteria.length}):
          </Text>
          <VStack align="start" gap={1} pl={2}>
            {results.metCriteria.map((criterion, idx) => (
              <Text key={idx} color={CONSOLE_COLORS.successColor} fontSize="sm">
                • {criterion}
              </Text>
            ))}
          </VStack>
        </Box>
      )}

      {/* Unmet Criteria */}
      {results.unmetCriteria && results.unmetCriteria.length > 0 && (
        <Box>
          <Text
            color={CONSOLE_COLORS.failureColor}
            fontWeight="semibold"
            mb={1}
          >
            ✗ Unmet Criteria ({results.unmetCriteria.length}):
          </Text>
          <VStack align="start" gap={1} pl={2}>
            {results.unmetCriteria.map((criterion, idx) => (
              <Text key={idx} color={CONSOLE_COLORS.failureColor} fontSize="sm">
                • {criterion}
              </Text>
            ))}
          </VStack>
        </Box>
      )}

      {/* Reasoning */}
      {results.reasoning && (
        <Box>
          <Text color="white" fontWeight="semibold" mb={1}>
            Reasoning:
          </Text>
          <Text
            color={REASONING_VERDICT_COLOR_MAP[results.verdict]}
            fontSize="sm"
            pl={2}
            whiteSpace="pre-wrap"
            fontWeight="bold"
          >
            {results.reasoning}
          </Text>
        </Box>
      )}
    </VStack>
  );
}
