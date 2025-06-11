import React from "react";
import { Box, Code, Flex, Text, VStack, HStack, Badge } from "@chakra-ui/react";
import { useColorModeValue } from "~/components/ui/color-mode";
import type { ScenarioResults } from "~/app/api/scenario-events/[[...route]]/schemas";
import { Verdict } from "~/app/api/scenario-events/[[...route]]/enums";

// Helper hook for console styling
function useConsoleColors() {
  const consoleBg = useColorModeValue("gray.900", "gray.800");
  const consoleText = useColorModeValue("green.300", "green.300");
  const headerColor = useColorModeValue("white", "white");
  const successColor = useColorModeValue("green.300", "green.300");
  const failureColor = useColorModeValue("red.400", "red.400");
  const warningColor = useColorModeValue("yellow.400", "yellow.400");

  return {
    consoleBg,
    consoleText,
    headerColor,
    successColor,
    failureColor,
    warningColor,
  };
}

// Console header component
function ConsoleHeader() {
  return (
    <Text color="white" fontWeight="bold" mb={2}>
      === Scenario Test Report ===
    </Text>
  );
}

// Status display component
function StatusDisplay({
  status,
  verdict,
  colors,
}: {
  status?: string;
  verdict?: Verdict;
  colors: ReturnType<typeof useConsoleColors>;
}) {
  const getStatusColor = () => {
    if (verdict === Verdict.Success) return colors.successColor;
    if (verdict === Verdict.Failure) return colors.failureColor;
    if (verdict === Verdict.Inconclusive) return colors.warningColor;
    return status === "SUCCESS" ? colors.successColor : colors.failureColor;
  };

  const getStatusText = () => {
    if (verdict) {
      return verdict === Verdict.Success
        ? "PASSED"
        : verdict === Verdict.Failure
        ? "FAILED"
        : "INCONCLUSIVE";
    }
    return status === "SUCCESS" ? "PASSED" : "FAILED";
  };

  return (
    <HStack>
      <Text color="white">Status:</Text>
      <Text color={getStatusColor()} fontWeight="bold">
        {getStatusText()}
      </Text>
    </HStack>
  );
}

// Metrics summary component
function MetricsSummary({
  results,
  durationInMs,
  colors,
}: {
  results?: ScenarioResults;
  durationInMs?: number;
  colors: ReturnType<typeof useConsoleColors>;
}) {
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
        <Text color={metCount > 0 ? colors.successColor : colors.failureColor}>
          {metCount}/{totalCriteria}
        </Text>
      </HStack>
      <HStack>
        <Text color="white">Success Rate:</Text>
        <Text
          color={
            parseFloat(successRate) > 50
              ? colors.successColor
              : colors.failureColor
          }
        >
          {successRate}%
        </Text>
      </HStack>
      <HStack>
        <Text color="white">Duration:</Text>
        <Text color={colors.consoleText}>{duration}s</Text>
      </HStack>
    </VStack>
  );
}

// Criteria details component
function CriteriaDetails({
  results,
  colors,
}: {
  results?: ScenarioResults;
  colors: ReturnType<typeof useConsoleColors>;
}) {
  if (!results) return null;

  return (
    <VStack align="start" gap={3} pl={4}>
      {/* Met Criteria */}
      {results.metCriteria && results.metCriteria.length > 0 && (
        <Box>
          <Text color={colors.successColor} fontWeight="semibold" mb={1}>
            ✓ Met Criteria ({results.metCriteria.length}):
          </Text>
          <VStack align="start" gap={1} pl={2}>
            {results.metCriteria.map((criterion, idx) => (
              <Text key={idx} color={colors.successColor} fontSize="sm">
                • {criterion}
              </Text>
            ))}
          </VStack>
        </Box>
      )}

      {/* Unmet Criteria */}
      {results.unmetCriteria && results.unmetCriteria.length > 0 && (
        <Box>
          <Text color={colors.failureColor} fontWeight="semibold" mb={1}>
            ✗ Unmet Criteria ({results.unmetCriteria.length}):
          </Text>
          <VStack align="start" gap={1} pl={2}>
            {results.unmetCriteria.map((criterion, idx) => (
              <Text key={idx} color={colors.failureColor} fontSize="sm">
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
            color={colors.consoleText}
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

// Main console component
export function SimulationConsole({
  results,
  scenarioName,
  status,
  durationInMs,
}: {
  results?: ScenarioResults;
  scenarioName?: string;
  status?: string;
  durationInMs?: number;
}) {
  const colors = useConsoleColors();

  return (
    <Box
      bg={colors.consoleBg}
      color={colors.consoleText}
      p={4}
      borderRadius="md"
      fontFamily="mono"
      fontSize="sm"
      minHeight="200px"
      overflow="auto"
    >
      <Code
        colorScheme="green"
        bg="transparent"
        color="inherit"
        whiteSpace="pre-wrap"
        display="block"
        width="100%"
      >
        <VStack align="start" gap={3} width="100%">
          <ConsoleHeader />

          <StatusDisplay
            status={status}
            verdict={results?.verdict}
            colors={colors}
          />

          <MetricsSummary
            results={results}
            durationInMs={durationInMs}
            colors={colors}
          />

          {/* Scenario Name */}
          {scenarioName && (
            <HStack>
              <Text color="white">Scenario:</Text>
              <Text color={colors.consoleText}>{scenarioName}</Text>
            </HStack>
          )}

          <CriteriaDetails results={results} colors={colors} />
        </VStack>
      </Code>
    </Box>
  );
}
