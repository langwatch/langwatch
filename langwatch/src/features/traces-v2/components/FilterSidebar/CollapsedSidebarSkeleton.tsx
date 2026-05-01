import { Separator, Skeleton, VStack } from "@chakra-ui/react";
import type React from "react";

const SKELETON_CLUSTERS: number[] = [3, 4, 2];

/**
 * Collapsed-rail counterpart of `FilterSidebarSkeleton`. The rail is so
 * narrow that the expanded skeleton (rows + title bars per section)
 * doesn't fit — instead we render small circular placeholders matching
 * the live `IconButton` size, grouped with the same separators the real
 * `CollapsedSidebar` uses. Without this the user opens a fresh page
 * and sees an empty rail for the first ~few hundred ms it takes
 * `useTraceFacets` to resolve, which reads as "the sidebar is broken"
 * rather than "filters are loading."
 */
export const CollapsedSidebarSkeleton: React.FC = () => (
  <VStack
    height="full"
    gap={0}
    align="stretch"
    overflow="hidden"
    as="aside"
    aria-busy="true"
    aria-label="Loading filters"
  >
    <VStack
      flex={1}
      paddingY={2}
      gap={1}
      align="center"
      overflowY="auto"
      overflowX="hidden"
    >
      {SKELETON_CLUSTERS.map((count, idx) => (
        <VStack key={idx} gap={1} align="center" width="full">
          {idx > 0 && (
            <Separator
              marginX={2}
              marginY={0.5}
              width="auto"
              alignSelf="stretch"
            />
          )}
          {Array.from({ length: count }).map((_, i) => (
            <Skeleton
              key={i}
              width="20px"
              height="20px"
              borderRadius="sm"
            />
          ))}
        </VStack>
      ))}
    </VStack>
  </VStack>
);
