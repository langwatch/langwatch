import { Box, Skeleton, SkeletonText, VStack } from "@chakra-ui/react";

export function LicenseLoadingSkeleton() {
  return (
    <Box
      borderWidth="1px"
      borderRadius="lg"
      padding={6}
      width="full"
    >
      <VStack align="start" gap={4}>
        <Skeleton height="24px" width="150px" />
        <SkeletonText noOfLines={3} gap={2} width="full" />
      </VStack>
    </Box>
  );
}
