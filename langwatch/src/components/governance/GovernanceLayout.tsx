import {
  Box,
  Container,
  HStack,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import {
  AlertTriangle,
  Eye,
  PlugZap,
  Route,
} from "lucide-react";
import { type PropsWithChildren } from "react";

import { DashboardLayout } from "~/components/DashboardLayout";

import { MenuLink } from "../MenuLink";

/**
 * Layout for `/governance` — wraps DashboardLayout in `orgScope` mode
 * (no project picker in the header, replaced with an org-name chip
 * + "Organization-scoped" indicator) and renders a thin org-level
 * sub-navigation in the left column.
 *
 * The four sub-routes are admin-config surfaces under `/settings/...`
 * (Ingestion Sources, Anomaly Rules, Routing Policies). They keep
 * SettingsLayout chrome on their own pages — the GovernanceLayout
 * left rail is just the entry point for the daily-use home.
 *
 * Spec: specs/ai-gateway/governance/governance-home-routing.feature
 *       (the "future top-level layout" scenario, now current state)
 */
export default function GovernanceLayout({ children }: PropsWithChildren) {
  return (
    <DashboardLayout orgScope>
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
                  Governance
                </Text>
                <MenuLink
                  href="/governance"
                  includePath="/governance"
                  icon={<Eye size={14} />}
                >
                  Overview
                </MenuLink>
                <MenuLink
                  href="/settings/governance/ingestion-sources"
                  includePath="/settings/governance/ingestion-sources"
                  icon={<PlugZap size={14} />}
                >
                  Ingestion Sources
                </MenuLink>
                <MenuLink
                  href="/settings/governance/anomaly-rules"
                  includePath="/settings/governance/anomaly-rules"
                  icon={<AlertTriangle size={14} />}
                >
                  Anomaly Rules
                </MenuLink>
                <MenuLink
                  href="/settings/routing-policies"
                  includePath="/settings/routing-policies"
                  icon={<Route size={14} />}
                >
                  Routing Policies
                </MenuLink>
              </VStack>
              <Box paddingX={3} paddingTop={4}>
                <Text fontSize="xs" color="fg.subtle" lineHeight="1.5">
                  Sub-pages above are admin-config surfaces under
                  Settings. This Overview is the daily-use home.
                </Text>
              </Box>
            </Box>

            <Box flex={1} minWidth={0}>
              {children}
            </Box>
          </HStack>
          <Spacer />
        </Container>
      </Box>
    </DashboardLayout>
  );
}
