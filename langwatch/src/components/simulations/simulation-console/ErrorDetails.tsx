import { Box, Text, VStack } from "@chakra-ui/react";

import {
  resolveScenarioError,
  scenarioErrorTitle,
} from "~/server/scenarios/scenario-infra-error";
import { CONSOLE_COLORS } from "./constants";

interface ErrorDetailsProps {
  error: string;
}

/**
 * Error details component.
 *
 * Normalizes every run error into a clean, actionable handled error — a stable
 * title + human message + optional hint — and never shows a raw stack trace or
 * child-process dump. `resolveScenarioError` renders the encoded envelope the
 * failure handler produces directly, and classifies any other error string
 * (e.g. the scenario SDK's `{ name, message, stack }`) on the fly so it reads
 * the same.
 *
 * @see ~/server/scenarios/scenario-infra-error
 */
export function ErrorDetails({ error }: ErrorDetailsProps) {
  const handled = resolveScenarioError(error);

  return (
    <Box data-testid="scenario-handled-error">
      <Text color={CONSOLE_COLORS.failureColor} fontWeight="semibold" mb={1}>
        {scenarioErrorTitle(handled.code)}
      </Text>
      <VStack align="start" gap={2} pl={2}>
        <Text color={CONSOLE_COLORS.consoleText} fontSize="sm">
          {handled.message}
        </Text>
        {handled.hint && (
          <Text
            color={CONSOLE_COLORS.warningColor}
            fontSize="sm"
            data-testid="scenario-handled-error-hint"
          >
            {handled.hint}
          </Text>
        )}
      </VStack>
    </Box>
  );
}
