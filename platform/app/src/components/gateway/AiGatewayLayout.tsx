import {
  Box,
  Container,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  Brain,
  ExternalLink,
  Gauge,
  KeyRound,
  LineChart,
  Route,
  Shield,
  Zap,
} from "lucide-react";
import { type PropsWithChildren } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";

import { MenuLink } from "../MenuLink";

/**
 * Layout for `/ai-gateway/*` — mirrors GovernanceLayout pattern:
 * single-link parent in the main sidebar, full Virtual Keys / Budgets /
 * Providers / Cache Rules / Usage sub-nav rendered inside the page as a
 * thin left column. Each gateway page wraps with this layout instead of
 * the five-children CollapsibleMenuGroup that previously cluttered the
 * primary sidebar.
 *
 * Org-scoped (no project picker in the header) because every gateway
 * resource — VirtualKey / GatewayBudget / GatewayProviderCredential —
 * lives at the org level in the Prisma schema, so the chrome should
 * reflect that boundary.
 */
export default function AiGatewayLayout({
  children,
  pageTitle,
}: PropsWithChildren<{ pageTitle?: string }>) {
  return (
    <DashboardLayout orgScope pageTitle={pageTitle}>
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
                  href={`/settings/gateway/virtual-keys`}
                  includePath={`/settings/gateway/virtual-keys`}
                  icon={<KeyRound size={14} />}
                >
                  Virtual Keys
                </MenuLink>
                <MenuLink
                  href={`/settings/model-providers`}
                  includePath={`/settings/model-providers`}
                  icon={<Brain size={14} />}
                  menuEnd={<ExternalLink size={12} aria-hidden />}
                  target="_blank"
                >
                  Model Providers
                </MenuLink>
                <MenuLink
                  href={`/settings/gateway/budgets`}
                  includePath={`/settings/gateway/budgets`}
                  icon={<Gauge size={14} />}
                >
                  Budgets
                </MenuLink>
                <MenuLink
                  href={`/settings/gateway/cache-rules`}
                  includePath={`/settings/gateway/cache-rules`}
                  icon={<Zap size={14} />}
                >
                  Cache Rules
                </MenuLink>
                <MenuLink
                  href={`/settings/gateway/guardrails`}
                  includePath={`/settings/gateway/guardrails`}
                  icon={<Shield size={14} />}
                >
                  Guardrails
                </MenuLink>
                <MenuLink
                  href={`/settings/gateway/usage`}
                  includePath={`/settings/gateway/usage`}
                  icon={<LineChart size={14} />}
                >
                  Usage
                </MenuLink>
                <MenuLink
                  href={`/settings/routing-policies`}
                  includePath={`/settings/routing-policies`}
                  icon={<Route size={14} />}
                >
                  Routing Policies
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
