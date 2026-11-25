/** A board page's frame: a wide screen keeps its full content width, up to a readable cap. */

import { Box, VStack } from "@langwatch/design-system/primitives";
import type { ReactNode } from "react";

export function BoardPage({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <VStack
      align="stretch"
      gap={0}
      width="full"
      maxWidth="1440px"
      marginX="auto"
      paddingX={8}
      paddingY={6}
      lineHeight="1.45"
    >
      {header}
      <Box as="section" aria-label="Widgets" minHeight="240px">
        {children}
      </Box>
    </VStack>
  );
}
