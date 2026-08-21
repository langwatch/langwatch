import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

import type { SectionNavItemData } from "./sectionNavItems";

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
 * adding its call here — the exhaustive `default: false` lookup below
 * makes a forgotten flag hide its item, which is the safe failure.
 */
export function useVisibleSectionNavItems(
  items: readonly SectionNavItemData[],
): SectionNavItemData[] {
  // Flags roll out per organization (PostHog release conditions / rule
  // matching fails closed without ctx.organizationId), so the check must
  // carry the same org context the page guards pass — otherwise a per-org
  // enable shows the pages but never their nav items.
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const billedCost = useFeatureFlag(
    "release_ui_governance_billed_cost_enabled",
    { organizationId: organization?.id, enabled: !!organization?.id },
  );

  const flagEnabled = (
    flag: NonNullable<SectionNavItemData["featureFlag"]>,
  ) => {
    switch (flag) {
      case "release_ui_governance_billed_cost_enabled":
        return billedCost.enabled;
      default:
        return false;
    }
  };

  return items.filter(
    (item) => item.featureFlag === undefined || flagEnabled(item.featureFlag),
  );
}
