import { useNavigationHost } from "../model/navigation-host";
import type { SectionNavItemData } from "../model/section-nav-items";

/**
 * Filters a section nav list down to the items whose `featureFlag` is
 * enabled (items without one always show). Both renderers of the shared
 * lists — the legacy SectionNavigationLayout rail (via GovernanceLayout)
 * and the navigation-v2 ProductSidebar — must go through this, or the two
 * presentations disagree on what exists.
 *
 * Hooks cannot be called in a loop over arbitrary flags, so every flag
 * that appears in a nav list is resolved here by name. Today that is one:
 * the billed-cost placeholders. Adding a second flag to a nav list means
 * touching three places here, and they fail differently. Miss its
 * `useFeatureFlag` call or its `case` in the lookup and the catch-all
 * `default: false` below hides the item — the safe failure, and the
 * reason the switch keeps a default rather than checking exhaustively.
 * Miss its
 * `enabled` gate and nothing hides: the query simply runs on lists that
 * never read it, costing a round-trip nobody sees.
 */
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
