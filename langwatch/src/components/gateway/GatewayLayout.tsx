import { Box, HStack, VStack } from "@chakra-ui/react";
import { FileClock, Gauge, KeyRound, LineChart, Plug, Settings } from "lucide-react";
import { type PropsWithChildren } from "react";

import { MenuLink } from "~/components/MenuLink";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * Inner layout for the AI Gateway section. Renders a sub-nav on the left
 * mirroring the existing `SettingsLayout` pattern so the visual language is
 * shared across platform admin areas.
 */
export function GatewayLayout({ children }: PropsWithChildren) {
  const { project, hasPermission } = useOrganizationTeamProject();
  const slug = project?.slug ?? "";

  return (
    <HStack
      align="start"
      width="full"
      height="calc(100vh - 56px)"
      gap={0}
    >
      <VStack
        align="start"
        paddingX={2}
        paddingY={4}
        fontSize="14px"
        minWidth="200px"
        height="full"
        overflowY="auto"
        flexShrink={0}
        gap={1}
      >
        {hasPermission("virtualKeys:view") && (
          <MenuLink
            href={`/${slug}/gateway/virtual-keys`}
            icon={<KeyRound size={16} />}
          >
            Virtual Keys
          </MenuLink>
        )}
        {hasPermission("gatewayBudgets:view") && (
          <MenuLink
            href={`/${slug}/gateway/budgets`}
            icon={<Gauge size={16} />}
          >
            Budgets
          </MenuLink>
        )}
        {hasPermission("gatewayProviders:view") && (
          <MenuLink
            href={`/${slug}/gateway/providers`}
            icon={<Plug size={16} />}
          >
            Providers
          </MenuLink>
        )}
        {hasPermission("gatewayUsage:view") && (
          <MenuLink
            href={`/${slug}/gateway/usage`}
            icon={<LineChart size={16} />}
          >
            Usage
          </MenuLink>
        )}
        {hasPermission("gatewayLogs:view") && (
          <MenuLink
            href={`/${slug}/gateway/audit`}
            icon={<FileClock size={16} />}
          >
            Audit log
          </MenuLink>
        )}
        {hasPermission("project:update") && (
          <MenuLink
            href={`/${slug}/gateway/settings`}
            icon={<Settings size={16} />}
          >
            Settings
          </MenuLink>
        )}
      </VStack>
      <Box flex={1} height="full" overflowY="auto">
        {children}
      </Box>
    </HStack>
  );
}
