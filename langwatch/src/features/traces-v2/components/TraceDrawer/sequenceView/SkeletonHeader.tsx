import { Box, Flex, Skeleton } from "@chakra-ui/react";

/**
 * Header bar shared by SequenceSkeleton and TopologySkeleton — keeps the
 * two loading states visually flush with the real header above them.
 */
export function SkeletonHeader() {
  return (
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
  );
}
