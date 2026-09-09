/**
 * The full-bleed body a list page uses.
 *
 * A FAMILY-LOCAL COPY of
 * `platform/app/src/components/ui/layouts/FullWidthListPageContent.tsx`, whose
 * one other consumer is the experiments list — a downstream anti-target that
 * stays in `platform/app`, so deletes-only forbids repointing it.
 *
 * Fifteen lines, and the spec asks for them by name: the configuration table
 * expands to the available content width rather than being constrained to a
 * compact centered column.
 */

import { Box } from "@chakra-ui/react";
import type { PropsWithChildren } from "react";

export function FullWidthListPageContent({ children }: PropsWithChildren) {
  return (
    <Box data-testid="full-width-list-page-content" width="full" paddingX={6} paddingTop={4}>
      {children}
    </Box>
  );
}
