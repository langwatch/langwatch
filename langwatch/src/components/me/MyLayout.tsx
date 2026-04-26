import {
  Box,
  Container,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Gauge, KeyRound } from "lucide-react";
import { type PropsWithChildren } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";

import { MenuLink } from "../MenuLink";

import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { usePersonalContext } from "./usePersonalContext";

/**
 * Layout for /me/* pages — wraps the standard DashboardLayout (so the
 * top-bar, sidebar, and account menu are consistent with the rest of
 * the app) but renders a personal-scope sub-navigation in the left
 * column and a `<WorkspaceSwitcher>` chip at the very top.
 *
 * Spec: specs/ai-gateway/governance/my-usage-dashboard.feature,
 *       specs/ai-gateway/governance/my-settings.feature,
 *       specs/ai-gateway/governance/workspace-switcher.feature
 */
export default function MyLayout({ children }: PropsWithChildren) {
  const { switcher } = usePersonalContext();

  return (
    <DashboardLayout>
      <Box width="full" paddingY={4} paddingX={4}>
        <VStack align="stretch" gap={4} width="full">
          <HStack width="full">
            <WorkspaceSwitcher
              personal={switcher.personal}
              teams={switcher.teams}
              projects={switcher.projects}
              current={{ kind: "personal" }}
            />
            <Spacer />
          </HStack>

          <Container maxW="container.xl" paddingX={0}>
            <HStack alignItems="start" gap={6} width="full">
              <Box
                width="220px"
                minWidth="220px"
                borderRight="1px solid"
                borderColor="border.muted"
                paddingRight={4}
              >
                <VStack align="stretch" gap={1}>
                  <Text
                    fontSize="xs"
                    fontWeight="semibold"
                    color="fg.muted"
                    paddingX={3}
                    paddingTop={1}
                    paddingBottom={2}
                    textTransform="uppercase"
                    letterSpacing="wider"
                  >
                    My Workspace
                  </Text>
                  <MenuLink href="/me" icon={<Gauge size={14} />}>
                    My Usage
                  </MenuLink>
                  <MenuLink
                    href="/me/settings"
                    includePath="/me/settings"
                    icon={<KeyRound size={14} />}
                  >
                    Settings
                  </MenuLink>
                </VStack>
              </Box>

              <Box flex={1} minWidth={0}>
                {children}
              </Box>
            </HStack>
          </Container>
        </VStack>
      </Box>
    </DashboardLayout>
  );
}
