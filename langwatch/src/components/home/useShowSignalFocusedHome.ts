import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

/**
 * The rollout flag the signal-focused home hangs off, and the only lever
 * that switches the composition. Registered with `defaultValue: false`, so
 * every project keeps the classic home until the flag is explicitly turned
 * on for a project, an organization, or a user.
 */
export const SIGNAL_FOCUSED_HOME_FLAG =
  "release_ui_home_signal_focused_enabled" as const;

/**
 * The home composition gate — "does this user get the signal-focused home?"
 * (spec: specs/home/signal-focused-home-rollout.feature). Purely the rollout
 * flag, evaluated for the current project: page access is already
 * DashboardLayout's job, and Langy access is deliberately NOT part of the
 * answer — the redesigned home rolls out on its own schedule. Langy access
 * still gates the hand-to-Langy affordances INSIDE the sheet (useShowLangy
 * in HomeBriefingSection and QuietHeadline), so the two rollouts compose
 * without either implying the other.
 */
export function useShowSignalFocusedHome(): boolean {
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const { enabled } = useFeatureFlag(SIGNAL_FOCUSED_HOME_FLAG, {
    projectId: project?.id,
    enabled: !!project,
  });
  return enabled;
}
