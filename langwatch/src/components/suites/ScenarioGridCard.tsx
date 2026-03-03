/**
 * Grid card for a scenario run, used in grid view mode.
 *
 * Wraps SimulationCard to display a scenario run result as a card
 * with status overlay and a combined "Scenario x Target (#N)" title.
 */

import { Box, Text, VStack } from "@chakra-ui/react";
import { SimulationCard } from "~/components/simulations/SimulationCard";
import type { ScenarioRunData } from "~/server/scenarios/scenario-event.types";

function extractContent(message: Record<string, unknown>): string | null {
  if (typeof message.content === "string" && message.content && message.content !== "None") {
    return message.content;
  }
  return null;
}

function extractRole(message: Record<string, unknown>): string {
  const role = typeof message.role === "string" ? message.role : "unknown";
  if (role === "assistant" || role === "agent") return "Agent";
  if (role === "user") return "User";
  return role.charAt(0).toUpperCase() + role.slice(1);
}

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
        <VStack align="start" gap={1} padding={3} overflow="hidden">
          {(scenarioRun.messages as Record<string, unknown>[])
            .slice(0, 4)
            .map((msg, i) => {
              const content = extractContent(msg);
              if (!content) return null;
              const role = extractRole(msg);
              return (
                <Text key={i} fontSize="xs" color="fg.muted" lineClamp={2}>
                  <Text as="span" fontWeight="semibold">{role}:</Text>{" "}
                  {content}
                </Text>
              );
            })}
        </VStack>
      </SimulationCard>
    </Box>
  );
}
