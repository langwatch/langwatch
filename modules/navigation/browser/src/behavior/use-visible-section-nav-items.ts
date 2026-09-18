import { useNavigationHost } from "../model/navigation-host.ts";
import type { SectionNavItemData } from "../model/section-nav-items.ts";

/** Filters nav list to enabled-flag items; both renderers must use this or disagree on existence */
export function useVisibleSectionNavItems(
  items: readonly SectionNavItemData[],
): SectionNavItemData[] {
  // Flags roll out per organization (PostHog release conditions / rule
  // matching fails closed without ctx.organizationId), so the host answers
  // them with the same org context the page guards carry — otherwise a per-org
  // enable shows the pages but never their nav items.
  const host = useNavigationHost();
  // Gateway pages render this hook too, and gatewayNavItems carries no flagged
  // entry — without this the flag is asked on every gateway page for a result
  // the filter below never reads.
  const needsBilledCost = items.some(
    (item) => item.featureFlag === "release_ui_governance_billed_cost_enabled",
  );
  const billedCost = needsBilledCost
    ? host.featureFlag("release_ui_governance_billed_cost_enabled")
    : { enabled: false, isLoading: false };

  const flagEnabled = (flag: NonNullable<SectionNavItemData["featureFlag"]>) => {
    switch (flag) {
      case "release_ui_governance_billed_cost_enabled":
        return billedCost.enabled;
      default:
        return false;
    }
  };

  return items.filter((item) => item.featureFlag === undefined || flagEnabled(item.featureFlag));
}
