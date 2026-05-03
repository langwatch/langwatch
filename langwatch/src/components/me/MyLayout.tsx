import { Box, Container } from "@chakra-ui/react";
import { type PropsWithChildren } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";

/**
 * Layout for /me/* pages — delegates the entire chrome (header logo +
 * WorkspaceSwitcher chip + user avatar + personal-scope sidebar) to
 * `DashboardLayout` running in `personalScope` mode. Per gateway.md
 * Screen 6: ONE workspace chip (top-left), no project sidebar, no
 * Govern/Gateway sections — the personal-only chrome.
 *
 * Spec: specs/ai-gateway/governance/my-usage-dashboard.feature,
 *       specs/ai-gateway/governance/my-settings.feature,
 *       specs/ai-gateway/governance/persona-aware-chrome.feature
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
