/**
 * Grid card for a scenario run, used in grid view mode.
 *
 * Wraps SimulationCard to display a scenario run result as a card
 * with status overlay and a "Target: Scenario (#N)" title.
 * Uses MessagePreview for a lightweight conversation preview that
 * doesn't require the CopilotKit runtime.
 */

import { Box, HStack, Text } from "@chakra-ui/react";
import { X } from "lucide-react";
import { SimulationCard } from "~/components/simulations/SimulationCard";
import { MessagePreview } from "./MessagePreview";
import { buildDisplayTitle } from "./run-history-transforms";
import { isCancellableStatus } from "./useCancelScenarioRun";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";

type ScenarioGridCardProps = {
  scenarioRun: ScenarioRunData;
  targetName: string | null;
  onClick: () => void;
  iteration?: number;
  onCancel?: () => void;
};

export function ScenarioGridCard({
  scenarioRun,
  targetName,
  onClick,
  iteration,
  onCancel,
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
      position="relative"
    >
      <SimulationCard title={title} status={scenarioRun.status}>
        <MessagePreview messages={scenarioRun.messages} />
      </SimulationCard>
      {onCancel && isCancellableStatus(scenarioRun.status) && (
        <HStack
          as="span"
          role="button"
          tabIndex={0}
          gap={1}
          position="absolute"
          top={1}
          right={1}
          zIndex={30}
          paddingX={2}
          paddingY={0.5}
          borderRadius="sm"
          fontSize="xs"
          color="red.500"
          bg="bg.panel"
          cursor="pointer"
          _hover={{ bg: "red.50" }}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onCancel();
          }}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.stopPropagation();
              e.preventDefault();
              onCancel();
            }
          }}
          aria-label="Cancel run"
          data-testid="cancel-run-button"
        >
          <X size={12} />
          <Text fontSize="xs">Cancel</Text>
        </HStack>
      )}
    </Box>
  );
}
