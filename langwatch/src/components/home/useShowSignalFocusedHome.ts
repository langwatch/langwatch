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
  return useSignalFocusedHomeVisibility().show;
}

/**
 * The same gate, with its uncertainty exposed.
 *
 * `enabled` reads `false` while the flag is in flight, which is right for
 * hiding a control and wrong for picking a page: this composition wins
 * outright, so nothing else can be decided until it has answered.
 */
export function useSignalFocusedHomeVisibility(): {
  show: boolean;
  isResolving: boolean;
} {
  const { project, organization, isLoading: contextLoading } =
    useOrganizationTeamProject({
      redirectToOnboarding: false,
      redirectToProjectOnboarding: false,
    });
  const { enabled, isLoading: flagLoading } = useFeatureFlag(
    SIGNAL_FOCUSED_HOME_FLAG,
    {
      projectId: project?.id,
      // Without the organization, an org-targeted rollout rule can never
      // match and the whole org silently stays on the classic home.
      organizationId: organization?.id,
      enabled: !!project,
    },
  );
  return {
    show: enabled,
    // A reader with no project is decided, not pending — the flag query is
    // disabled for them and will never answer.
    isResolving: contextLoading || (!!project && flagLoading),
  };
}
