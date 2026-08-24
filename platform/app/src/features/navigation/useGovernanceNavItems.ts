import { useMemo } from "react";

import { useFeatureFlag } from "~/hooks/useFeatureFlag";

import type { SectionNavItemData } from "./sectionNavItems";
import { governanceNavItems } from "./sectionNavItems";

/**
 * Drops the navigation items whose feature flag is off, keeping the
 * declared order. Both governance shells (the legacy layout rails and the
 * product sidebar) filter through this one function so they cannot drift.
 */
export function filterFlaggedNavItems(
  items: readonly SectionNavItemData[],
  flagEnabled: (flag: string) => boolean,
): SectionNavItemData[] {
  return items.filter(
    (item) => !item.featureFlag || flagEnabled(item.featureFlag),
  );
}

/**
 * The governance sidebar items visible to the current reader: every
 * ungated item, plus Costs / Billed only while
 * `release_ui_governance_billed_cost_enabled` is on for their org.
 *
 * While the flag query is still resolving the gated items stay hidden; a
 * flag that is on adds them a moment later instead of flashing them and
 * pulling them back.
 */
export function useGovernanceNavItems(): readonly SectionNavItemData[] {
  const { enabled: spendEnabled } = useFeatureFlag(
    "release_ui_governance_billed_cost_enabled",
  );

  return useMemo(
    () => filterFlaggedNavItems(governanceNavItems, () => spendEnabled),
    [spendEnabled],
  );
}
