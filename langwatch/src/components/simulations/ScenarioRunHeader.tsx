import { Box, HStack, Text, VStack } from "@chakra-ui/react";

import { ScenarioRunStatus } from "~/app/api/scenario-events/[[...route]]/enums";
import { ScenarioRunStatusIcon } from "./ScenarioRunStatusIcon";

interface ScenarioRunHeaderProps {
  status?: ScenarioRunStatus;
  name?: string;
  scenarioId?: string;
}

export function ScenarioRunHeader({
  status,
  name,
  scenarioId,
}: ScenarioRunHeaderProps) {
  return (
    <Box
      p={5}
      borderBottom="1px"
      borderColor="gray.200"
      w="100%"
    >
      <HStack justify="space-between" align="center">
        <VStack gap={4}>
          <VStack align="space-between" gap={0}>
            <HStack>
              <ScenarioRunStatusIcon status={status} />
              <Text fontSize="lg" fontWeight="semibold">
                {name}
              </Text>
            </HStack>
            <Text fontSize="sm" color="gray.500" ml={5}>
              Scenario ID: {scenarioId}
            </Text>
          </VStack>
        </VStack>
      </HStack>
    </Box>
  );
}
