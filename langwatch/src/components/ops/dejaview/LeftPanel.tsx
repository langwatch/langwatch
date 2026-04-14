import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { Circle } from "lucide-react";

export function LeftPanel({
  projections,
  reactors,
  selectedProjection,
  onSelectProjection,
  currentEventType,
}: {
  projections: Array<{
    projectionName: string;
    pipelineName: string;
    aggregateType: string;
  }>;
  reactors: Array<{
    reactorName: string;
    pipelineName: string;
    aggregateType: string;
    afterProjection: string;
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
            Reactors
          </Text>
        </Box>
        {reactors.length === 0 ? (
          <Box paddingX={3} paddingY={4}>
            <Text textStyle="xs" color="fg.muted">
              No reactors for this aggregate type.
            </Text>
          </Box>
        ) : (
          reactors.map((reactor) => (
            <Box
              key={reactor.reactorName}
              paddingX={3}
              paddingY={2}
              borderBottom="1px solid"
              borderBottomColor="border"
            >
              <HStack gap={2}>
                <Circle
                  size={8}
                  fill="currentColor"
                  color="purple.500"
                />
                <VStack align="start" gap={0}>
                  <Text textStyle="xs" fontWeight="medium">
                    {reactor.reactorName}
                  </Text>
                  <Text textStyle="xs" color="fg.muted">
                    after {reactor.afterProjection}
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
