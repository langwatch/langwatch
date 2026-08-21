import { useFeatureFlag } from "~/hooks/useFeatureFlag";

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
  const billedCost = useFeatureFlag(
    "release_ui_governance_billed_cost_enabled",
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
