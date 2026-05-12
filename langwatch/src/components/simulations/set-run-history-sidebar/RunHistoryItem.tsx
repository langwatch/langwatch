import { Box, HStack, Text } from "@chakra-ui/react";
import React from "react";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { ScenarioRunStatusIcon } from "~/components/simulations/ScenarioRunStatusIcon";
import { useSimulationRouter } from "~/hooks/simulations/useSimulationRouter";
import type { RunItem } from "./types";

// Single test case row
export const RunHistoryItem = ({ item }: { item: RunItem }) => {
  const { goToSimulationRun, scenarioSetId } = useSimulationRouter();
  return (
    <HStack
      align="center"
      gap={3}
      py={2}
      pl={3}
      cursor="pointer"
      onClick={(e) => {
        e.stopPropagation();
        if (scenarioSetId) {
          goToSimulationRun({
            scenarioSetId,
            batchRunId: item.batchRunId,
            scenarioRunId: item.scenarioRunId,
          });
        }
      }}
    >
      <ScenarioRunStatusIcon status={item.status} boxSize={4} mt={1} />
      <Box>
        <Text fontWeight="semibold" fontSize="xs">
          {item.title}
        </Text>
        <Text fontSize="xs" color="fg.muted">
          {item.description}
        </Text>
      </Box>
    </HStack>
  );
};
