/**
 * Frame for /me/* pages (container only; chrome belongs to route tree).
 */

import { Box, Container } from "@chakra-ui/react";
import type { PropsWithChildren } from "react";

export function PersonalWorkspaceLayout({ children }: PropsWithChildren) {
  return (
    <Container maxW="container.xl" paddingX={4} paddingY={4}>
      <Box width="full">{children}</Box>
    </Container>
  );
}

export default PersonalWorkspaceLayout;
