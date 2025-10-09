import { Box, HStack, Skeleton, SkeletonText, VStack } from "@chakra-ui/react";
import React from "react";

interface SpookyScarySkeletonProps {
  loading: boolean;
}

const SpookyScarySkeleton: React.FC<SpookyScarySkeletonProps> = ({ loading }) => {
  return (
    <VStack gap={6} align="stretch">
      <VStack gap={4} align="stretch">
        <Skeleton loading={loading} height="40px" borderRadius="md" variant="shine" />
        <SkeletonText loading={loading} noOfLines={1} gap="2" variant="shine" />

        <HStack gap={3} align="center">
          <Skeleton loading={loading} boxSize="16px" borderRadius="xs" variant="shine" />
          <SkeletonText loading={loading} noOfLines={1} w="65%" variant="shine" />
        </HStack>
      </VStack>

      <HStack justify="space-between" w="full">
        <Box />

        <HStack gap={3}>
          <Skeleton loading={loading} height="36px" w="80px" borderRadius="md" variant="shine" />
          <Skeleton loading={loading} height="36px" w="96px" borderRadius="md" variant="shine" />
        </HStack>
      </HStack>
    </VStack>
  );
}

export default SpookyScarySkeleton;
