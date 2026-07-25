import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Circle } from "lucide-react";

export function LeftPanel({
  projections,
  eventSubscribers,
  selectedProjection,
  onSelectProjection,
  currentEventType,
}: {
  projections: Array<{
    projectionName: string;
    pipelineName: string;
    aggregateType: string;
  }>;
  eventSubscribers: Array<{
    subscriberName: string;
    pipelineName: string;
    aggregateType: string;
    eventTypes: readonly string[];
  }>;
  selectedProjection: string | null;
  onSelectProjection: (name: string | null) => void;
  currentEventType: string | null;
}) {
  return (
    <Box
      width="280px"
      minWidth="280px"
      borderRight="1px solid"
      borderRightColor="border"
      overflowY="auto"
      bg="bg.surface"
    >
      <VStack align="stretch" gap={0}>
        <Box paddingX={3} paddingY={2} borderBottom="1px solid" borderBottomColor="border">
          <Text textStyle="xs" fontWeight="semibold" color="fg.muted" textTransform="uppercase" letterSpacing="wider">
            Fold Projections
          </Text>
        </Box>

        {projections.length === 0 ? (
          <Box paddingX={3} paddingY={4}>
            <Text textStyle="xs" color="fg.muted">
              No projections for this aggregate type.
            </Text>
          </Box>
        ) : (
          projections.map((proj) => {
            const isSelected = selectedProjection === proj.projectionName;
            return (
              <Box
                key={proj.projectionName}
                paddingX={3}
                paddingY={2}
                cursor="pointer"
                bg={isSelected ? "bg.emphasized" : "transparent"}
                _hover={{ bg: isSelected ? "bg.emphasized" : "bg.muted" }}
                borderBottom="1px solid"
                borderBottomColor="border"
                onClick={() =>
                  onSelectProjection(
                    isSelected ? null : proj.projectionName,
                  )
                }
              >
                <HStack gap={2}>
                  <Circle
                    size={8}
                    fill="currentColor"
                    color="green.500"
                  />
                  <VStack align="start" gap={0}>
                    <Text textStyle="xs" fontWeight="medium">
                      {proj.projectionName}
                    </Text>
                    <Text textStyle="xs" color="fg.muted">
                      {proj.pipelineName}
                    </Text>
                  </VStack>
                </HStack>
              </Box>
            );
          })
        )}

        <Box
          paddingX={3}
          paddingY={2}
          borderBottom="1px solid"
          borderBottomColor="border"
          marginTop={2}
        >
          <Text textStyle="xs" fontWeight="semibold" color="fg.muted" textTransform="uppercase" letterSpacing="wider">
            Event Subscribers
          </Text>
        </Box>
        {eventSubscribers.length === 0 ? (
          <Box paddingX={3} paddingY={4}>
            <Text textStyle="xs" color="fg.muted">
              No event subscribers for this aggregate type.
            </Text>
          </Box>
        ) : (
          eventSubscribers.map((subscriber) => (
            <Box
              key={subscriber.subscriberName}
              paddingX={3}
              paddingY={2}
              borderBottom="1px solid"
              borderBottomColor="border"
            >
              <HStack gap={2}>
                <Circle
                  size={8}
                  fill="currentColor"
                  color="cyan.500"
                />
                <VStack align="start" gap={0} minW={0}>
                  <Text textStyle="xs" fontWeight="medium">
                    {subscriber.subscriberName}
                  </Text>
                  <Text textStyle="xs" color="fg.muted" truncate>
                    {subscriber.eventTypes.length > 0
                      ? `on ${subscriber.eventTypes.join(", ")}`
                      : subscriber.pipelineName}
                  </Text>
                </VStack>
              </HStack>
            </Box>
          ))
        )}
      </VStack>
    </Box>
  );
}
