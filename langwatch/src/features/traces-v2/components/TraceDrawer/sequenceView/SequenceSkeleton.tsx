import { Box, HStack, Skeleton, VStack } from "@chakra-ui/react";
import { SkeletonHeader } from "./SkeletonHeader";

/**
 * Minimal placeholder for the sequence diagram while its chunk + Mermaid
 * are loading. Chakra's <Skeleton> brings the shimmer; we just stand up the
 * silhouette of a sequence diagram (a row of participant boxes + a few
 * lifeline + signal hints) so the eye knows what's coming.
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
