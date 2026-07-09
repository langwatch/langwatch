/**
 * Loading placeholder for the run history list, mirroring the real layout
 * (sticky run-row header followed by a grid of scenario cards) so content
 * doesn't jump when data lands — same approach as the Traces V2 table's
 * skeleton rows.
 */

import { Box, Grid, HStack, Skeleton, VStack } from "@chakra-ui/react";

function SkeletonHeaderRow() {
  return (
    <Box padding={2} paddingBottom={0} width="full">
      <HStack
        width="full"
        paddingX={4}
        paddingY={3}
        gap={3}
        bg="bg.panel/70"
        borderWidth="1px"
        borderColor="border.muted"
        borderRadius="lg"
        boxShadow="xs"
      >
        <Skeleton height="14px" width="14px" borderRadius="sm" />
        <Skeleton height="14px" width="120px" />
        <Skeleton height="12px" width="48px" />
        <Box flex={1} />
        <Skeleton height="22px" width="160px" borderRadius="lg" />
      </HStack>
    </Box>
  );
}

function SkeletonCard() {
  return (
    <VStack
      height="200px"
      borderWidth="1px"
      borderColor="border.muted"
      borderRadius="xl"
      bg="bg.panel"
      boxShadow="sm"
      padding={3}
      align="stretch"
      gap={3}
    >
      <Skeleton height="12px" width="70%" />
      <Box flex={1} />
      <Skeleton height="26px" width="55%" borderRadius="lg" alignSelf="flex-end" />
      <Skeleton height="26px" width="75%" borderRadius="lg" />
      <Skeleton height="26px" width="45%" borderRadius="lg" alignSelf="flex-end" />
    </VStack>
  );
}

export function RunHistorySkeleton({ sections = 2 }: { sections?: number }) {
  return (
    <VStack
      align="stretch"
      gap={0}
      data-testid="run-history-skeleton"
      aria-busy="true"
      aria-label="Loading runs"
    >
      {Array.from({ length: sections }).map((_, sectionIndex) => (
        <Box key={sectionIndex}>
          <SkeletonHeaderRow />
          <Grid
            templateColumns="repeat(auto-fill, minmax(250px, 1fr))"
            gap={4}
            padding={4}
          >
            {Array.from({ length: 3 - sectionIndex }).map((_, cardIndex) => (
              <SkeletonCard key={cardIndex} />
            ))}
          </Grid>
        </Box>
      ))}
    </VStack>
  );
}
