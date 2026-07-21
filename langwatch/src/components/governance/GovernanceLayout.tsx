import { Box, Text } from "@chakra-ui/react";
import {
  AlertTriangle,
  Eye,
  PackageOpen,
  PlugZap,
  Route,
  Wallet,
} from "lucide-react";
import { type PropsWithChildren } from "react";
import { SectionNavigationLayout } from "~/components/ui/layouts/SectionNavigationLayout";

/**
 * Layout for `/governance` - wraps DashboardLayout in `orgScope` mode
 * (no project picker in the header, replaced with an org-name chip
 * + "Organization-scoped" indicator) and renders a thin org-level
 * sub-navigation in the left column.
 *
 * The four sub-routes are admin-config surfaces under `/settings/...`
 * (Ingestion Sources, Anomaly Rules, Routing Policies). They keep
 * SettingsLayout chrome on their own pages - the GovernanceLayout
 * left rail is just the entry point for the daily-use home.
 *
 * Spec: specs/ai-gateway/governance/governance-home-routing.feature
 *       (the "future top-level layout" scenario, now current state)
 */
export default function GovernanceLayout({
  children,
  pageTitle,
}: PropsWithChildren<{ pageTitle?: string }>) {
  return (
    <SectionNavigationLayout
      sectionLabel="AI Governance"
      orgScope
      pageTitle={pageTitle}
      navigationItems={[
        {
          label: "Overview",
          href: "/governance",
          includePath: "/governance",
          icon: <Eye size={14} />,
        },
        {
          label: "Ingestion Sources",
          href: "/settings/governance/ingestion-sources",
          includePath: "/settings/governance/ingestion-sources",
          icon: <PlugZap size={14} />,
        },
        {
          label: "Anomaly Rules",
          href: "/settings/governance/anomaly-rules",
          includePath: "/settings/governance/anomaly-rules",
          icon: <AlertTriangle size={14} />,
        },
        {
          label: "Routing Policies",
          href: "/settings/routing-policies",
          includePath: "/settings/routing-policies",
          icon: <Route size={14} />,
        },
        {
          label: "Tool Catalog",
          href: "/settings/governance/tool-catalog",
          includePath: "/settings/governance/tool-catalog",
          icon: <PackageOpen size={14} />,
        },
        {
          label: "Departments",
          href: "/settings/governance/departments",
          includePath: "/settings/governance/departments",
          icon: <Wallet size={14} />,
        },
      ]}
      sidebarFooter={
        <Box paddingX={3} paddingTop={4}>
          <Text fontSize="xs" color="fg.subtle" lineHeight="1.5">
            Sub-pages above are admin-config surfaces under Settings. This
            Overview is the daily-use home, plus a few lightweight org-policy
            toggles at the bottom.
          </Text>
        </Box>
      }
    >
      {children}
    </SectionNavigationLayout>
  );
}
