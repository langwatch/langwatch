import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { NOT_TARGETED } from "~/server/featureFlag/targeting";
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
  // matching fails closed without ctx.organizationId), so the check must
  // carry the same org context the page guards pass — otherwise a per-org
  // enable shows the pages but never their nav items.
  const { project, organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  // Gateway pages render this hook too (AiGatewayLayout), and gatewayNavItems
  // carries no flagged entry — without this the flag round-trips on every
  // gateway page for a result the filter below never reads.
  const needsBilledCost = items.some(
    (item) => item.featureFlag === "release_ui_governance_billed_cost_enabled",
  );
  const billedCost = useFeatureFlag(
    "release_ui_governance_billed_cost_enabled",
    {
      projectId: project?.id ?? NOT_TARGETED,
      organizationId: organization?.id,
      enabled: !!organization?.id && needsBilledCost,
    },
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
