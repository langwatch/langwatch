/**
 * The GOVERN group, rendered identically in the project column and the
 * personal one.
 *
 * Moved from `platform/app/src/components/sidebar/GovernSection.tsx`. Single
 * source of truth for the icons, labels, flag gates and the beta pill, so the
 * two columns cannot drift apart.
 *
 * The two flag reads keep the pending state the host carries: an entry that
 * appears a beat after the rest of the column reads as the menu changing under
 * the reader, so a flag still in flight shows nothing rather than a placeholder.
 */

import { Eye } from "lucide-react";
import React from "react";
import { useNavigationHost } from "../../model/navigation-host";
import { featureIcons } from "../../model/feature-icons";
import { isPathUnder } from "../../model/products";
import { SidebarSection } from "../blocks/sidebar-section";
import { SideMenuLink } from "../blocks/side-menu-link";

export const GovernSection = React.memo(function GovernSection({
  showExpanded,
}: {
  showExpanded: boolean;
}) {
  const host = useNavigationHost();
  const pathname = host.pathname();
  const gatewayMenuEnabled = host.featureFlag("release_ui_ai_gateway_menu_enabled").enabled;
  const governancePreviewEnabled = host.featureFlag("release_ui_ai_governance_enabled").enabled;

  const showGatewayEntry = gatewayMenuEnabled && host.hasPermission("virtualKeys:view");
  const showGovernanceEntry = governancePreviewEnabled && host.hasPermission("governance:view");

  if (!showGatewayEntry && !showGovernanceEntry) return null;

  const isGatewayActive =
    isPathUnder({ pathname, base: "/gateway" }) || pathname === "/settings/model-providers";
  const isGovernanceActive = isPathUnder({ pathname, base: "/governance" });

  return (
    <SidebarSection id="govern" label="Govern" showExpanded={showExpanded} defaultExpanded={false}>
      {showGatewayEntry && (
        <SideMenuLink
          icon={featureIcons.gateway.icon}
          label="AI Gateway"
          href="/gateway/virtual-keys"
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
