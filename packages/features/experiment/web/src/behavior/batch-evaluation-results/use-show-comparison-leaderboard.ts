import { useFeatureFlag } from "@langwatch/workflow-web/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "@langwatch/ui-host/use-organization-team-project";
import { NOT_TARGETED } from "@langwatch/feature-flag-contract";

/**
 * The rollout flag the Bradley-Terry leaderboard hangs off (issue #5103).
 * Registered with `defaultValue: false`, so every organization keeps the
 * plain win-rate chart until the flag is explicitly turned on for it.
 */
export const COMPARISON_LEADERBOARD_FLAG = "release_ui_comparison_leaderboard_enabled" as const;

/**
 * Whether this reader gets the leaderboard at all (spec:
 * specs/experiments/comparison-leaderboard.feature).
 */
export function useShowComparisonLeaderboard(): boolean {
  const { project, organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const { enabled } = useFeatureFlag(COMPARISON_LEADERBOARD_FLAG, {
    projectId: project?.id ?? NOT_TARGETED,
    organizationId: organization?.id,
    // Without the organization there is nothing for an org-targeted rule to
    // match, so the query would only ever answer false.
    enabled: !!organization?.id,
  });
  return enabled;
}
