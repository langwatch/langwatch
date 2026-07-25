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
import { SectionNavigationLayout } from "~/components/ui/layouts/SectionNavigationLayout";

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
    <SectionNavigationLayout
      sectionLabel="AI Gateway"
      orgScope
      pageTitle={pageTitle}
      navigationItems={[
        {
          label: "Virtual Keys",
          href: "/settings/gateway/virtual-keys",
          includePath: "/settings/gateway/virtual-keys",
          icon: <KeyRound size={14} />,
        },
        {
          label: "Model Providers",
          href: "/settings/model-providers",
          includePath: "/settings/model-providers",
          icon: <Brain size={14} />,
          menuEnd: <ExternalLink size={12} aria-hidden />,
          target: "_blank",
        },
        {
          label: "Budgets",
          href: "/settings/gateway/budgets",
          includePath: "/settings/gateway/budgets",
          icon: <Gauge size={14} />,
        },
        {
          label: "Cache Rules",
          href: "/settings/gateway/cache-rules",
          includePath: "/settings/gateway/cache-rules",
          icon: <Zap size={14} />,
        },
        {
          label: "Guardrails",
          href: "/settings/gateway/guardrails",
          includePath: "/settings/gateway/guardrails",
          icon: <Shield size={14} />,
        },
        {
          label: "Usage",
          href: "/settings/gateway/usage",
          includePath: "/settings/gateway/usage",
          icon: <LineChart size={14} />,
        },
        {
          label: "Routing Policies",
          href: "/settings/routing-policies",
          includePath: "/settings/routing-policies",
          icon: <Route size={14} />,
        },
      ]}
    >
      {children}
    </SectionNavigationLayout>
  );
}
