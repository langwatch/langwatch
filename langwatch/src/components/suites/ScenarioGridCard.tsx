/**
 * Grid card for a scenario run, used in grid view mode.
 *
 * Wraps SimulationCard to display a scenario run result as a card
 * with status overlay and a combined "Scenario x Target (#N)" title.
 */

import { Box, Text } from "@chakra-ui/react";
import { SimulationCard } from "~/components/simulations/SimulationCard";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";

type ScenarioGridCardProps = {
  scenarioRun: ScenarioRunData;
  targetName: string | null;
  onClick: () => void;
  iteration?: number;
};

/**
 * Builds a combined display title in the format: "Scenario x Target (#N)".
 * Omits target and iteration segments when not available.
 */
function buildDisplayTitle({
  scenarioName,
  targetName,
  iteration,
}: {
  scenarioName: string;
  targetName: string | null;
  iteration?: number;
}): string {
  let title = scenarioName;
  if (targetName) title += ` \u00d7 ${targetName}`;
  if (iteration != null) title += ` (#${iteration})`;
  return title;
}

export function ScenarioGridCard({
  scenarioRun,
  targetName,
  onClick,
  iteration,
}: ScenarioGridCardProps) {
  const scenarioName = scenarioRun.name ?? scenarioRun.scenarioId;
  const title = buildDisplayTitle({ scenarioName, targetName, iteration });

  return (
    <Box
      as="button"
      onClick={onClick}
      cursor="pointer"
      height="160px"
      textAlign="left"
      aria-label={`View details for ${title}`}
      _hover={{ transform: "translateY(-2px)", transition: "transform 0.15s" }}
    >
      <SimulationCard title={title} status={scenarioRun.status}>
        <Text fontSize="xs" color="fg.muted" padding={3}>
          {scenarioRun.messages.length > 0
            ? `${scenarioRun.messages.length} messages`
            : "\u00a0"}
        </Text>
      </SimulationCard>
    </Box>
  );
}
