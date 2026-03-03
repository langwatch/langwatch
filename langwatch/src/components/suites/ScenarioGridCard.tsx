/**
 * Grid card for a scenario run, used in grid view mode.
 *
 * Wraps SimulationCard to display a scenario run result as a card
 * with status overlay and duration info.
 */

import { Box, HStack, Text } from "@chakra-ui/react";
import { SimulationCard } from "~/components/simulations/SimulationCard";
import { SCENARIO_RUN_STATUS_CONFIG } from "~/components/simulations/scenario-run-status-config";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";

type ScenarioGridCardProps = {
  scenarioRun: ScenarioRunData;
  targetName: string | null;
  onClick: () => void;
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ScenarioGridCard({
  scenarioRun,
  targetName,
  onClick,
}: ScenarioGridCardProps) {
  const scenarioName = scenarioRun.name ?? scenarioRun.scenarioId;
  const displayName = targetName
    ? `${scenarioName} \u00d7 ${targetName}`
    : scenarioName;

  const config = SCENARIO_RUN_STATUS_CONFIG[scenarioRun.status];

  return (
    <Box
      as="button"
      onClick={onClick}
      cursor="pointer"
      height="160px"
      textAlign="left"
      aria-label={`View details for ${displayName}`}
      _hover={{ transform: "translateY(-2px)", transition: "transform 0.15s" }}
    >
      <SimulationCard title={displayName} status={scenarioRun.status}>
        <Box padding={3}>
          <HStack gap={2}>
            {config.isComplete && (
              <Text fontSize="xs" color={config.fgColor}>
                {config.label}
              </Text>
            )}
            {scenarioRun.durationInMs > 0 && (
              <Text fontSize="xs" color="fg.muted">
                {formatDuration(scenarioRun.durationInMs)}
              </Text>
            )}
          </HStack>
        </Box>
      </SimulationCard>
    </Box>
  );
}
