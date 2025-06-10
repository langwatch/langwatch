import { Card, VStack, Text } from "@chakra-ui/react";
import type { ScenarioSetData } from "~/app/api/scenario-events/[[...route]]/types";

export interface SetCardProps extends ScenarioSetData {
  onClick: () => void;
}

export function SetCard({
  scenarioSetId,
  scenarioCount,
  lastRunAt,
  onClick,
}: SetCardProps) {
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  };

  return (
    <Card.Root
      bg="white"
      border="1px solid"
      borderColor="gray.200"
      borderRadius="lg"
      p="5"
      _hover={{
        borderColor: "gray.300",
        transform: "translateY(-1px)",
        shadow: "sm",
      }}
      transition="all 0.15s ease"
      cursor="pointer"
      onClick={onClick}
      position="relative"
    >
      <VStack align="stretch" gap="4">
        {/* Scenarios count */}
        <Text fontSize="lg" fontWeight="600" color="gray.900">
          {scenarioCount} scenarios
        </Text>

        {/* Last run timestamp */}
        <Text fontSize="sm" color="gray.500">
          Last run: {formatDate(lastRunAt)}
        </Text>

        {/* Scenario set ID */}
        <Text fontSize="xs" color="gray.500">
          Scenario set ID: {scenarioSetId}
        </Text>
      </VStack>
    </Card.Root>
  );
}
