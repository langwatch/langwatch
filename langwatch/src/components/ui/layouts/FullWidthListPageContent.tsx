import { Box } from "@chakra-ui/react";
import type { PropsWithChildren } from "react";

export function FullWidthListPageContent({ children }: PropsWithChildren) {
  return (
    <Box
      data-testid="full-width-list-page-content"
      width="full"
      paddingX={6}
      paddingTop={4}
    >
      {children}
    </Box>
  );
}
