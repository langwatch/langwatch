/**
 * Full-bleed body for list pages; a family-local copy to avoid repointing
 * platform/app's experiments list.
 */

import { Box } from "@langwatch/design-system/primitives";
import type { PropsWithChildren } from "react";

export function FullWidthListPageContent({ children }: PropsWithChildren) {
  return (
    <Box data-testid="full-width-list-page-content" width="full" paddingX={6} paddingTop={4}>
      {children}
    </Box>
  );
}
