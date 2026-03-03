/**
 * Grid card for a scenario run, used in grid view mode.
 *
 * Wraps SimulationCard to display a scenario run result as a card
 * with status overlay, scenario name, target name, iteration, and duration.
 */

import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { SimulationCard } from "~/components/simulations/SimulationCard";
import { SCENARIO_RUN_STATUS_CONFIG } from "~/components/simulations/scenario-run-status-config";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";

type ScenarioGridCardProps = {
  scenarioRun: ScenarioRunData;
  targetName: string | null;
  onClick: () => void;
  iteration?: number;
};

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function ScenarioGridCard({
  scenarioRun,
  targetName,
  onClick,
  iteration,
}: ScenarioGridCardProps) {
  const scenarioName = scenarioRun.name ?? scenarioRun.scenarioId;
  const config = SCENARIO_RUN_STATUS_CONFIG[scenarioRun.status];

  return (
    <Box
      as="button"
      onClick={onClick}
      cursor="pointer"
      height="160px"
      textAlign="left"
      aria-label={`View details for ${scenarioName}`}
      _hover={{ transform: "translateY(-2px)", transition: "transform 0.15s" }}
    >
      <SimulationCard title={scenarioName} status={scenarioRun.status}>
        <VStack align="start" padding={3} gap={1}>
          {targetName && (
            <Text fontSize="xs" color="fg.muted" data-testid="card-target-name">
              Target: {targetName}
            </Text>
          )}
          <HStack gap={2} flexWrap="wrap">
            {iteration != null && (
              <Text fontSize="xs" color="fg.muted" data-testid="card-iteration">
                Iteration {iteration}
              </Text>
            )}
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
        </VStack>
      </SimulationCard>
    </Box>
  );
}
