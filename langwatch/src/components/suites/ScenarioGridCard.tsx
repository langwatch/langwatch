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
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";

type ScenarioGridCardProps = {
  scenarioRun: ScenarioRunData;
  targetName: string | null;
  onClick: () => void;
  iteration?: number;
};

/**
 * Builds a display title in the format: "Target: Scenario (#N)".
 * Omits target prefix and iteration suffix when not available.
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
  let title = targetName ? `${targetName}: ${scenarioName}` : scenarioName;
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
      height="200px"
      textAlign="left"
      aria-label={`View details for ${title}`}
      _hover={{ transform: "translateY(-2px)", transition: "transform 0.15s" }}
    >
      <SimulationCard title={title} status={scenarioRun.status}>
        <MessagePreview messages={scenarioRun.messages} />
      </SimulationCard>
    </Box>
  );
}
