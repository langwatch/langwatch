import { Box, Container } from "@chakra-ui/react";
import type { ReactNode } from "react";

/**
 * The full-width page frame for product pages inside a navigation-v2
 * shell. Where the legacy chrome gives a section its own local rail
 * (SectionNavigationFrame), the v2 product sidebar already lists those
 * pages, so the content takes the whole card, keeping the same padding
 * and readable maximum width as the rail layout.
 *
 * Spec: specs/navigation/shared-section-navigation-layout.feature
 */
export function ProductPageFrame({ children }: { children: ReactNode }) {
  return (
    <Box width="full" padding={4} data-testid="product-page-frame">
      <Container maxW="1600px" paddingX={0}>
        {children}
      </Container>
    </Box>
  );
}
