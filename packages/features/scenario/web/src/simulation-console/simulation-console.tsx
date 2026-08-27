import { Box, Circle, Code, HStack, Text, VStack } from "@chakra-ui/react";
import type { ReactNode } from "react";
import {
  SimulationRunStatus as ScenarioRunStatus,
  type SimulationRunResult as ScenarioResults,
} from "@langwatch/scenario-contract";
import { CriteriaDetails } from "./criteria-details";
import { CONSOLE_COLORS } from "./constants";
import { ErrorDetails } from "./error-details";
import { MetricsSummary } from "./metrics-summary";
import { StatusDisplay } from "./status-display";

/** Width of the traffic-light cluster — mirrored on the right so the filename centers. */
const TRAFFIC_LIGHTS_WIDTH = "44px";

/** What the title bar reads when the caller names no file. */
export const DEFAULT_CONSOLE_FILE_NAME = "simulation-results.log";

/**
 * macOS-style terminal title bar. Traffic lights render greyscale — the
 * unfocused-window treatment — since they're decoration, not controls.
 * The right slot hosts actions (e.g. copy results) at the same width as
 * the light cluster so the filename stays centered.
 */
function ConsoleTitleBar({ actions, fileName }: { actions?: ReactNode; fileName: string }) {
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
      <Text flex={1} textAlign="center" textStyle="2xs" color="gray.400" fontFamily="mono">
        {fileName}
      </Text>
      <HStack width={TRAFFIC_LIGHTS_WIDTH} flexShrink={0} justify="flex-end" gap={0}>
        {actions}
      </HStack>
    </HStack>
  );
}

export function SimulationConsole({
  results,
  scenarioName,
  status,
  durationInMs,
  titleBarActions,
  fileName = DEFAULT_CONSOLE_FILE_NAME,
}: {
  results?: ScenarioResults | null;
  scenarioName?: string;
  status?: ScenarioRunStatus;
  durationInMs?: number;
  /** Rendered in the title bar's right slot (e.g. a copy-results button). */
  titleBarActions?: ReactNode;
  /** What the title bar reads. Agent Testing calls these test results. */
  fileName?: string;
}) {
  const isPending =
    status === ScenarioRunStatus.IN_PROGRESS || status === ScenarioRunStatus.PENDING;

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
      <ConsoleTitleBar actions={titleBarActions} fileName={fileName} />
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

            {!isPending && <MetricsSummary results={results} durationInMs={durationInMs} />}

            {/* Scenario Name */}
            {scenarioName && (
              <HStack>
                <Text color="white">Scenario:</Text>
                <Text color={CONSOLE_COLORS.consoleText}>{scenarioName}</Text>
              </HStack>
            )}

            {!isPending && !results?.error && <CriteriaDetails results={results} />}

            {/* Error Details */}
            {!isPending && results?.error && <ErrorDetails error={results.error} />}
          </VStack>
        </Code>
      </Box>
    </Box>
  );
}
