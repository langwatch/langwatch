import { Box, Card, HStack, Text, VStack } from "@chakra-ui/react";
import { Settings } from "lucide-react";
import type { ScenarioSetData } from "~/server/scenarios/scenario-event.types";
import {
  isOnPlatformSet,
  ON_PLATFORM_DISPLAY_NAME,
} from "~/server/scenarios/internal-set-id";
import { formatTimeAgo } from "~/utils/formatTimeAgo";

export interface SetCardProps extends ScenarioSetData {
  onClick: () => void;
}

export function SetCard({
  scenarioSetId,
  scenarioCount,
  lastRunAt,
  onClick,
}: SetCardProps) {
  const isInternalSet = isOnPlatformSet(scenarioSetId);
  const displayName = isInternalSet ? ON_PLATFORM_DISPLAY_NAME : scenarioSetId;

  const _formatDate = (timestamp: number) => {
    const date = new Date(timestamp);

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(date);
  };

  return (
    <Card.Root
      bg="bg.panel"
      border="1px solid"
      borderColor="border"
      borderRadius="xl"
      boxShadow="lg"
      p="5"
      _hover={{
        borderColor: "border.emphasized",
        transform: "translateY(-1px)",
        shadow: "xl",
      }}
      transition="all 0.15s ease"
      cursor="pointer"
      onClick={onClick}
      position="relative"
    >
      <VStack align="stretch" gap="2">
        {isInternalSet ? (
          <Box fontSize="2xl" paddingBottom="2" color="fg.subtle">
            <Settings size={28} aria-label="System set icon" />
          </Box>
        ) : (
          <Text fontSize="2xl" paddingBottom="2">
            {"\uD83C\uDFAD"}
          </Text>
        )}
        <Text fontWeight="500" color="fg">
          {displayName}
        </Text>

        {/* Scenarios count and last run in a row */}
        <HStack
          justify="space-between"
          align="center"
          color="fg.subtle"
          fontSize="sm"
        >
          <Text>{scenarioCount} scenarios</Text>
          <Text>Last run: {formatTimeAgo(lastRunAt)}</Text>
        </HStack>
      </VStack>
    </Card.Root>
  );
}
