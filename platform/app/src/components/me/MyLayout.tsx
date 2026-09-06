import { Box, Container } from "@chakra-ui/react";
import type { PropsWithChildren } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";

/**
 * Layout for /me/* pages. Delegates the chrome to `DashboardLayout` in
 * `personalScope` mode: one workspace chip, the personal sidebar, no
 * project sidebar and no Govern group.
 *
 * Spec: specs/ai-gateway/governance/my-usage-dashboard.feature,
 *       specs/ai-gateway/governance/my-settings.feature
 */
export default function MyLayout({ children }: PropsWithChildren) {
  return (
    <DashboardLayout personalScope>
      <Container maxW="container.xl" paddingX={4} paddingY={4}>
        <Box width="full">{children}</Box>
      </Container>
    </DashboardLayout>
  );
}
