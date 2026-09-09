/**
 * The frame every `/gateway/*` page renders inside: content only, no local
 * rail, since the product sidebar already lists every destination.
 * KNOWN GAP: the outer `NavigationShell` chrome does not wrap this yet.
 */

import { Box, Container } from "@chakra-ui/react";
import type { PropsWithChildren } from "react";

export default function AiGatewayLayout({ children }: PropsWithChildren<{ pageTitle?: string }>) {
  return (
    <Box width="full" padding={4} data-testid="section-navigation-layout">
      <Container maxW="1600px" paddingX={0} data-testid="section-navigation-container">
        <Box width="full" data-testid="section-navigation-content">
          {children}
        </Box>
      </Container>
    </Box>
  );
}
