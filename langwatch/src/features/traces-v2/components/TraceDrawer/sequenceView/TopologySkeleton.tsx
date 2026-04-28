import { Box, Flex, Skeleton, VStack } from "@chakra-ui/react";

/**
 * Minimal placeholder for the topology view: a few rounded "node" cards
 * scattered across the canvas, each shimmering via Chakra's built-in
 * Skeleton. Different silhouette from SequenceSkeleton (no lifelines) so
 * users can tell which view is loading at a glance.
 */
const NODES = [
  { left: "8%", top: "28%", width: "16%", height: "30px" },
  { left: "34%", top: "18%", width: "18%", height: "30px" },
  { left: "34%", top: "62%", width: "18%", height: "30px" },
  { left: "62%", top: "30%", width: "20%", height: "30px" },
  { left: "62%", top: "70%", width: "20%", height: "30px" },
] as const;

export function TopologySkeleton() {
  return (
    <VStack align="stretch" gap={0} height="full" overflow="hidden">
      <Flex
        align="center"
        gap={2}
        paddingX={3}
        paddingY={1.5}
        borderBottomWidth="1px"
        borderColor="border.subtle"
        bg="bg.subtle/60"
        flexShrink={0}
      >
        <Skeleton height="14px" width="80px" borderRadius="sm" />
        <Box flex="1" />
        <Skeleton height="14px" width="120px" borderRadius="sm" />
      </Flex>

      <Box flex="1" position="relative">
        {NODES.map((n, i) => (
          <Skeleton
            key={i}
            position="absolute"
            top={n.top}
            left={n.left}
            width={n.width}
            height={n.height}
            borderRadius="md"
          />
        ))}
      </Box>
    </VStack>
  );
}
