import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * The rollout flag the Bradley-Terry leaderboard hangs off (issue #5103).
 * Registered with `defaultValue: false`, so every organization keeps the
 * plain win-rate chart until the flag is explicitly turned on for it.
 */
export const COMPARISON_LEADERBOARD_FLAG =
  "release_ui_comparison_leaderboard_enabled" as const;

/**
 * Whether this reader gets the leaderboard at all
 * (spec: specs/experiments/comparison-leaderboard.feature).
 *
 * Org-targeted rather than project-targeted: the leaderboard is a way of
 * reading a Comparison, not a property of one dataset, so enabling it for a
 * customer means enabling it everywhere they work rather than project by
 * project.
 *
 * `enabled` reads false while the query is in flight, which is the right
 * default for hiding a chart: the results page renders without it and the
 * chart appears once the flag answers, rather than flashing a card that then
 * vanishes.
 *
 * Deliberately ONE gate covering both surfaces — the metric entry in the
 * Metrics dropdown and the chart it toggles. Gating only the chart would
 * leave a menu item that switches nothing on, which is worse than either
 * state on its own.
 */
export function useShowComparisonLeaderboard(): boolean {
  const { organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const { enabled } = useFeatureFlag(COMPARISON_LEADERBOARD_FLAG, {
    organizationId: organization?.id,
    // Without the organization there is nothing for an org-targeted rule to
    // match, so the query would only ever answer false.
    enabled: !!organization?.id,
  });
  return enabled;
}
