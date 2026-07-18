import { Eye } from "lucide-react";
import React from "react";

import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRouter } from "~/utils/compat/next-router";
import { featureIcons } from "~/utils/featureIcons";
import { SidebarSection } from "./SidebarSection";
import { SideMenuLink } from "./SideMenuLink";

/**
 * GOVERN section rendered identically in both the project-scope MainMenu
 * and the personal-scope PersonalSidebar. Single source of truth for
 * icons, labels, FF gating, and beta pills so the two sidebars never
 * drift apart.
 */
export const GovernSection = React.memo(function GovernSection({
  showExpanded,
}: {
  showExpanded: boolean;
}) {
  const router = useRouter();
  const { organization, hasPermission } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const { enabled: gatewayMenuEnabled } = useFeatureFlag(
    "release_ui_ai_gateway_menu_enabled",
    {
      organizationId: organization?.id,
      enabled: !!organization?.id,
    },
  );
  const { enabled: governancePreviewEnabled } = useFeatureFlag(
    "release_ui_ai_governance_enabled",
    {
      organizationId: organization?.id,
      enabled: !!organization?.id,
    },
  );

  const showGatewayEntry =
    gatewayMenuEnabled && hasPermission("virtualKeys:view");
  const showGovernanceEntry =
    governancePreviewEnabled && hasPermission("governance:view");

  if (!showGatewayEntry && !showGovernanceEntry) return null;

  const isGatewayActive =
    router.pathname.startsWith("/settings/gateway") ||
    router.pathname === "/settings/routing-policies" ||
    router.pathname === "/settings/model-providers";
  const isGovernanceActive =
    router.pathname === "/governance" ||
    router.pathname === "/settings/governance" ||
    router.pathname.startsWith("/settings/governance/");

  return (
    <SidebarSection id="govern" label="Govern" showExpanded={showExpanded}>
      {showGatewayEntry && (
        <SideMenuLink
          icon={featureIcons.gateway.icon}
          label="AI Gateway"
          href="/settings/gateway/virtual-keys"
          isActive={isGatewayActive}
          showLabel={showExpanded}
        />
      )}
      {showGovernanceEntry && (
        <SideMenuLink
          icon={Eye}
          label="AI Governance"
          href="/governance"
          isActive={isGovernanceActive}
          showLabel={showExpanded}
          beta
          betaLabel="Beta"
        />
      )}
    </SidebarSection>
  );
});
