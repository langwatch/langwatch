/**
 * Grid card for a scenario run, used in grid view mode.
 *
 * Wraps SimulationCard to display a scenario run result as a card
 * with status overlay and a "Target: Scenario (#N)" title.
 * Uses MessagePreview for a lightweight conversation preview that
 * doesn't require the CopilotKit runtime.
 */

import { Box, HStack, Spinner, Text } from "@chakra-ui/react";
import { Square } from "lucide-react";
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
  isCancelling?: boolean;
};

export function ScenarioGridCard({
  scenarioRun,
  targetName,
  onClick,
  iteration,
  onCancel,
  isCancelling = false,
}: ScenarioGridCardProps) {
  const scenarioName = scenarioRun.name ?? scenarioRun.scenarioId;
  const title = buildDisplayTitle({ scenarioName, targetName, iteration });

  return (
    <Box position="relative">
      <Box
        as="button"
        onClick={onClick}
        cursor="pointer"
        height="200px"
        textAlign="left"
        width="full"
        aria-label={`View details for ${title}`}
      >
        <SimulationCard title={title} status={scenarioRun.status}>
          <MessagePreview messages={scenarioRun.messages} />
        </SimulationCard>
      </Box>
      {onCancel && isCancellableStatus(scenarioRun.status) && (
        <HStack
          as="button"
          tabIndex={isCancelling ? -1 : 0}
          gap={1}
          paddingX={2}
          paddingY={0.5}
          borderRadius="md"
          border="1px solid"
          borderColor="gray.300"
          fontSize="xs"
          color="fg.default"
          bg="white"
          cursor={isCancelling ? "default" : "pointer"}
          opacity={isCancelling ? 0.6 : 1}
          _hover={isCancelling ? undefined : { bg: "gray.100", borderColor: "gray.400" }}
          position="absolute"
          top={2}
          right={2}
          zIndex={1}
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            if (!isCancelling) onCancel();
          }}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (!isCancelling && (e.key === "Enter" || e.key === " ")) {
              e.stopPropagation();
              e.preventDefault();
              onCancel();
            }
          }}
          aria-label="Stop run"
          aria-disabled={isCancelling}
          data-testid="cancel-run-button"
        >
          {isCancelling ? <Spinner size="xs" /> : <Square size={10} fill="currentColor" />}
          <Text fontSize="xs">Stop</Text>
        </HStack>
      )}
    </Box>
  );
}
