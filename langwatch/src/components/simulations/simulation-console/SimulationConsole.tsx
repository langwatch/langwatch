import { Box, Circle, Code, HStack, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { ScenarioRunStatus } from "@langwatch/contracts/scenarios/enums";
import type { ScenarioResults } from "@langwatch/contracts/scenarios/schemas";
import { CriteriaDetails } from "./CriteriaDetails";
import { CONSOLE_COLORS } from "./constants";
import { ErrorDetails } from "./ErrorDetails";
import { MetricsSummary } from "./MetricsSummary";
import { StatusDisplay } from "./StatusDisplay";

/** Width of the traffic-light cluster — mirrored on the right so the filename centers. */
const TRAFFIC_LIGHTS_WIDTH = "44px";

/**
 * macOS-style terminal title bar. Traffic lights render greyscale — the
 * unfocused-window treatment — since they're decoration, not controls.
 * The right slot hosts actions (e.g. copy results) at the same width as
 * the light cluster so the filename stays centered.
 */
function ConsoleTitleBar({ actions }: { actions?: ReactNode }) {
  return (
    <HStack
      paddingX={4}
      paddingY={2.5}
      borderBottomWidth="1px"
      borderColor="gray.800"
      bg="gray.900"
      position="sticky"
      top={0}
    >
      <HStack gap={1.5} width={TRAFFIC_LIGHTS_WIDTH} flexShrink={0}>
        <Circle size="10px" bg="gray.600" />
        <Circle size="10px" bg="gray.600" />
        <Circle size="10px" bg="gray.600" />
      </HStack>
      <Text
        flex={1}
        textAlign="center"
        textStyle="2xs"
        color="gray.400"
        fontFamily="mono"
      >
        simulation-results.log
      </Text>
      <HStack
        width={TRAFFIC_LIGHTS_WIDTH}
        flexShrink={0}
        justify="flex-end"
        gap={0}
      >
        {actions}
      </HStack>
    </HStack>
  );
}

/**
 * Main simulation console component
 * Single Responsibility: Orchestrates the display of scenario test results in a console-like interface
 */
export function SimulationConsole({
  results,
  scenarioName,
  status,
  durationInMs,
  titleBarActions,
}: {
  results?: ScenarioResults | null;
  scenarioName?: string;
  status?: ScenarioRunStatus;
  durationInMs?: number;
  /** Rendered in the title bar's right slot (e.g. a copy-results button). */
  titleBarActions?: ReactNode;
}) {
  const isPending =
    status === ScenarioRunStatus.IN_PROGRESS ||
    status === ScenarioRunStatus.PENDING;

  return (
    <Box
      bg={CONSOLE_COLORS.consoleBg}
      color={CONSOLE_COLORS.consoleText}
      fontFamily="mono"
      fontSize="13px"
      lineHeight="1.6"
      minHeight="200px"
      overflow="auto"
      width="full"
    >
      <ConsoleTitleBar actions={titleBarActions} />
      <Box paddingX={5} paddingY={4}>
        <Code
          colorPalette="green"
          bg="transparent"
          color="inherit"
          whiteSpace="pre-wrap"
          display="block"
          width="100%"
        >
          <VStack align="start" gap={3} width="100%">
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
    </Box>
  );
}
