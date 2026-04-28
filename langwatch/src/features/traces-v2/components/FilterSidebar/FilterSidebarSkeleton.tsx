import { HStack, Skeleton, VStack } from "@chakra-ui/react";
import type React from "react";

const SKELETON_SECTIONS: { titleWidth: string; rows: string[] }[] = [
  { titleWidth: "48px", rows: ["70%", "55%", "80%"] },
  { titleWidth: "56px", rows: ["60%", "75%", "50%", "65%"] },
  { titleWidth: "72px", rows: ["80%", "50%"] },
  { titleWidth: "44px", rows: ["65%", "70%", "55%"] },
];

export const FilterSidebarSkeleton: React.FC = () => {
  return (
    <VStack align="stretch" gap={0} aria-busy="true" aria-label="Loading filters">
      {SKELETON_SECTIONS.map((section, i) => (
        <VStack key={i} align="stretch" paddingX={3} paddingY={2} gap={2}>
          <Skeleton height="10px" width={section.titleWidth} borderRadius="sm" />
          <VStack align="stretch" gap={1.5} paddingTop={1}>
            {section.rows.map((width, j) => (
              <HStack key={j} gap={2}>
                <Skeleton height="10px" width="10px" borderRadius="sm" flexShrink={0} />
                <Skeleton height="10px" width={width} borderRadius="sm" />
              </HStack>
            ))}
          </VStack>
        </VStack>
      ))}
    </VStack>
  );
};
