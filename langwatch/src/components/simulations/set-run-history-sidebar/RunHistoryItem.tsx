import React from "react";
import { HStack, Text, Icon, Box } from "@chakra-ui/react";
import { Check, XCircle } from "react-feather";
import { useColorModeValue } from "../../ui/color-mode";
import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/enums";
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
      <Icon
        as={item.status === ScenarioRunStatus.SUCCESS ? Check : XCircle}
        color={
          item.status === ScenarioRunStatus.SUCCESS ? "green.400" : "red.400"
        }
        boxSize={4}
        mt={1}
      />
      <Box>
        <Text fontWeight="semibold" fontSize="xs">
          {item.title}
        </Text>
        <Text fontSize="xs" color={useColorModeValue("gray.600", "gray.400")}>
          {item.description}
        </Text>
      </Box>
    </HStack>
  );
};
