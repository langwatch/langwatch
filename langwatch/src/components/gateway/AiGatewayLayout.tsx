import {
  Box,
  Container,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import { Gauge, KeyRound, LineChart, Plug, Zap } from "lucide-react";
import { type PropsWithChildren } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

import { MenuLink } from "../MenuLink";

/**
 * Layout for `/[project]/gateway/*` — mirrors GovernanceLayout pattern:
 * single-link parent in the main sidebar, full Virtual Keys / Budgets /
 * Providers / Cache Rules / Usage sub-nav rendered inside the page as a
 * thin left column. Each gateway page wraps with this layout instead of
 * the five-children CollapsibleMenuGroup that previously cluttered the
 * primary sidebar.
 */
export default function AiGatewayLayout({
  children,
  pageTitle,
}: PropsWithChildren<{ pageTitle?: string }>) {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const slug = project?.slug ?? "";
  return (
    <DashboardLayout pageTitle={pageTitle}>
      <Box width="full" paddingY={4} paddingX={4}>
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
                  AI Gateway
                </Text>
                <MenuLink
                  href={`/${slug}/gateway/virtual-keys`}
                  includePath={`/${slug}/gateway/virtual-keys`}
                  icon={<KeyRound size={14} />}
                >
                  Virtual Keys
                </MenuLink>
                <MenuLink
                  href={`/${slug}/gateway/budgets`}
                  includePath={`/${slug}/gateway/budgets`}
                  icon={<Gauge size={14} />}
                >
                  Budgets
                </MenuLink>
                <MenuLink
                  href={`/${slug}/gateway/providers`}
                  includePath={`/${slug}/gateway/providers`}
                  icon={<Plug size={14} />}
                >
                  Providers
                </MenuLink>
                <MenuLink
                  href={`/${slug}/gateway/cache-rules`}
                  includePath={`/${slug}/gateway/cache-rules`}
                  icon={<Zap size={14} />}
                >
                  Cache Rules
                </MenuLink>
                <MenuLink
                  href={`/${slug}/gateway/usage`}
                  includePath={`/${slug}/gateway/usage`}
                  icon={<LineChart size={14} />}
                >
                  Usage
                </MenuLink>
              </VStack>
            </Box>

            <Box flex={1} minWidth={0}>{children}</Box>
          </HStack>
          <Spacer />
        </Container>
      </Box>
    </DashboardLayout>
  );
}
