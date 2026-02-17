import { Box, HStack, Text, VStack } from "@chakra-ui/react";

import type { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { ScenarioRunStatusIcon } from "./ScenarioRunStatusIcon";

interface ScenarioRunHeaderProps {
  status?: ScenarioRunStatus;
  name?: string | null;
  scenarioId?: string;
}

export function ScenarioRunHeader({
  status,
  name,
  scenarioId,
}: ScenarioRunHeaderProps) {
  return (
    <Box p={5} borderBottom="1px" borderColor="border" w="100%">
      <HStack justify="space-between" align="center">
        <VStack gap={4}>
          <VStack align="start" gap={0}>
            <HStack>
              <ScenarioRunStatusIcon status={status} />
              <Text fontSize="lg" fontWeight="semibold">
                {name}
              </Text>
            </HStack>
            <Text fontSize="sm" color="fg.muted" ml={5}>
              Scenario ID: {scenarioId}
            </Text>
          </VStack>
        </VStack>
      </HStack>
    </Box>
  );
}
