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
import { LangyContextTarget } from "~/features/langy/components/LangyContextTarget";
import { scenarioContextChip } from "~/features/langy/logic/langyContextChips";
import { MessagePreview } from "./MessagePreview";
import { buildDisplayTitle } from "./run-history-transforms";
import { isCancellableStatus } from "./useCancelScenarioRun";
import { usePrefetchRunState } from "./usePrefetchRunState";
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
  const prefetchRunState = usePrefetchRunState();
  const handlePrefetch = () => prefetchRunState(scenarioRun.scenarioRunId);

  return (
    // Armed, the run can be handed to Langy. Keyed on the run id — the same key
    // the `scenarioRunDetail` drawer derives — so pointing at a card and then
    // opening it is one chip. `borderRadius` matches the card inside it, since
    // Langy's outline follows the element's own radius.
    <LangyContextTarget
      target={scenarioContextChip({
        scenarioId: scenarioRun.scenarioRunId,
        name: title,
      })}
    >
    <Box position="relative" borderRadius="lg">
      <Box
        as="button"
        onClick={onClick}
        onMouseEnter={handlePrefetch}
        onFocus={handlePrefetch}
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
          as="span"
          role="button"
          tabIndex={isCancelling ? -1 : 0}
          gap={1}
          paddingX={2}
          paddingY={0.5}
          borderRadius="md"
          border="1px solid"
          borderColor="border"
          fontSize="xs"
          color="fg"
          bg="bg.panel"
          cursor={isCancelling ? "default" : "pointer"}
          opacity={isCancelling ? 0.6 : 1}
          _hover={isCancelling ? undefined : { bg: "bg.muted", borderColor: "border.emphasized" }}
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
          {isCancelling ? <Spinner size="xs" /> : <Square size={10} />}
          <Text fontSize="xs">Stop</Text>
        </HStack>
      )}
    </Box>
    </LangyContextTarget>
  );
}
