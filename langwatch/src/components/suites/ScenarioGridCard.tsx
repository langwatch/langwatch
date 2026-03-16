/**
 * Grid card for a scenario run, used in grid view mode.
 *
 * Wraps SimulationCard to display a scenario run result as a card
 * with status overlay and a "Target: Scenario (#N)" title.
 * Uses MessagePreview for a lightweight conversation preview that
 * doesn't require the CopilotKit runtime.
 */

import { Box } from "@chakra-ui/react";
import { SimulationCard } from "~/components/simulations/SimulationCard";
import { MessagePreview } from "./MessagePreview";
import { buildDisplayTitle } from "./run-history-transforms";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";

type ScenarioGridCardProps = {
  scenarioRun: ScenarioRunData;
  targetName: string | null;
  onClick: () => void;
  iteration?: number;
};

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
      height="200px"
      textAlign="left"
      aria-label={`View details for ${title}`}
      transition="transform 0.15s"
      _hover={{ transform: "translateY(-2px)" }}
    >
      <SimulationCard title={title} status={scenarioRun.status}>
        <MessagePreview messages={scenarioRun.messages} />
      </SimulationCard>
    </Box>
  );
}
