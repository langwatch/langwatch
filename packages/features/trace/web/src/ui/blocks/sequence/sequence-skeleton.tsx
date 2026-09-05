import { Box, HStack, Skeleton, VStack } from "@chakra-ui/react";
import { SkeletonHeader } from "../../elements/sequence/skeleton-header";

/**
 * Minimal placeholder for the sequence diagram while its chunk + Mermaid are loading.
 */
export function SequenceSkeleton() {
  return (
    <VStack align="stretch" gap={0} height="full" overflow="hidden">
      <SkeletonHeader />

      <Box flex="1" position="relative" paddingY={6} paddingX={6}>
        <HStack gap={8} justify="space-around">
          {[0, 1, 2, 3].map((i) => (
            <VStack key={i} align="center" gap={3} flex={1}>
              <Skeleton height="22px" width="80%" borderRadius="md" />
              <Skeleton height="160px" width="2px" borderRadius="full" />
            </VStack>
          ))}
        </HStack>
      </Box>
    </VStack>
  );
}
