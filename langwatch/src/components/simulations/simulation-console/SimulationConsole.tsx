import { Box, Code, HStack, Text, VStack } from "@chakra-ui/react";
import React from "react";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { ScenarioResults } from "~/server/scenarios/schemas";
import { ConsoleHeader } from "./ConsoleHeader";
import { CriteriaDetails } from "./CriteriaDetails";
import { CONSOLE_COLORS } from "./constants";
import { ErrorDetails } from "./ErrorDetails";
import { MetricsSummary } from "./MetricsSummary";
import { StatusDisplay } from "./StatusDisplay";

/**
 * Main simulation console component
 * Single Responsibility: Orchestrates the display of scenario test results in a console-like interface
 */
export function SimulationConsole({
  results,
  scenarioName,
  status,
  durationInMs,
}: {
  results?: ScenarioResults | null;
  scenarioName?: string;
  status?: ScenarioRunStatus;
  durationInMs?: number;
}) {
  const isPending = status === ScenarioRunStatus.IN_PROGRESS;

  return (
    <Box
      bg={CONSOLE_COLORS.consoleBg}
      color={CONSOLE_COLORS.consoleText}
      p={4}
      borderRadius="md"
      fontFamily="mono"
      fontSize="sm"
      minHeight="200px"
      overflow="auto"
    >
      <Code
        colorPalette="green"
        bg="transparent"
        color="inherit"
        whiteSpace="pre-wrap"
        display="block"
        width="100%"
      >
        <VStack align="start" gap={3} width="100%">
          <ConsoleHeader />

          <StatusDisplay status={status} verdict={results?.verdict} />

          {!isPending && (
            <MetricsSummary results={results} durationInMs={durationInMs} />
          )}

          {/* Scenario Name */}
          {scenarioName && (
            <HStack>
              <Text color="white">Scenario:</Text>
              <Text color={CONSOLE_COLORS.consoleText}>{scenarioName}</Text>
            </HStack>
          )}

          {!isPending && !Boolean(results?.error) && (
            <CriteriaDetails results={results} />
          )}

          {/* Error Details */}
          {!isPending && results?.error && (
            <ErrorDetails error={results.error} />
          )}
        </VStack>
      </Code>
    </Box>
  );
}
