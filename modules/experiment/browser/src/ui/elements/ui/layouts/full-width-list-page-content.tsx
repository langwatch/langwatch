import { Box } from "@langwatch/design-system/primitives";
import type { PropsWithChildren } from "react";

export function FullWidthListPageContent({ children }: PropsWithChildren) {
  return (
    <Box
      data-testid="full-width-list-page-content"
      width="full"
      paddingX="var(--page-inset)"
      paddingTop={4}
      paddingBottom={8}
    >
      {children}
    </Box>
  );
}
