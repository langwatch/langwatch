import { ExternalLink } from "lucide-react";
import type { PropsWithChildren } from "react";
import { SectionNavigationLayout } from "~/components/ui/layouts/SectionNavigationLayout";
import { gatewayNavItems } from "~/features/navigation/sectionNavItems";

/**
 * Layout for `/gateway/*`. Mirrors the GovernanceLayout pattern:
 * single-link parent in the main sidebar, full Virtual Keys / Budgets /
 * Providers / Cache Rules / Usage sub-nav rendered inside the page as a
 * thin left column. Each gateway page wraps with this layout instead of
 * the five-children CollapsibleMenuGroup that previously cluttered the
 * primary sidebar. The item list itself lives in
 * `~/features/navigation/sectionNavItems` so every shell renders the
 * same navigation.
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
      standDownRailInProductShell
      navigationItems={gatewayNavItems.map((item) => ({
        label: item.label,
        href: item.href,
        includePath: item.includePath,
        icon: <item.icon size={14} />,
        ...(item.isExternal
          ? {
              menuEnd: <ExternalLink size={12} aria-hidden />,
              target: "_blank" as const,
            }
          : {}),
      }))}
    >
      {children}
    </SectionNavigationLayout>
  );
}
