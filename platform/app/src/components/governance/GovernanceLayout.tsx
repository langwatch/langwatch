import type { PropsWithChildren } from "react";
import { SectionNavigationLayout } from "~/components/ui/layouts/SectionNavigationLayout";
import { governanceNavItems } from "~/features/navigation/sectionNavItems";
import { useVisibleSectionNavItems } from "~/features/navigation/useVisibleSectionNavItems";

/**
 * Layout for `/governance/*` - wraps DashboardLayout in `orgScope` mode
 * (no project picker in the header, replaced with an org-name chip
 * + "Organization-scoped" indicator) and renders a thin org-level
 * sub-navigation in the left column. The item list itself lives in
 * `~/features/navigation/sectionNavItems` so every shell renders the
 * same navigation.
 *
 * Spec: specs/ai-gateway/governance/governance-home-routing.feature
 */
export default function GovernanceLayout({
  children,
  pageTitle,
}: PropsWithChildren<{ pageTitle?: string }>) {
  const visibleItems = useVisibleSectionNavItems(governanceNavItems);
  return (
    <SectionNavigationLayout
      sectionLabel="AI Governance"
      orgScope
      pageTitle={pageTitle}
      standDownRailInProductShell
      navigationItems={visibleItems.map((item) => ({
        label: item.label,
        href: item.href,
        includePath: item.includePath,
        icon: <item.icon size={14} />,
      }))}
    >
      {children}
    </SectionNavigationLayout>
  );
}
