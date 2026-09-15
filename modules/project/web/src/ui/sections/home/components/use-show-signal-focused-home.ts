import { useProjectHomeHost } from "../../../../model/project-home-host.ts";
/**
 * The rollout flag the signal-focused home hangs off, and the only lever
 * that switches the composition. Registered with `defaultValue: false`, so
 * every project keeps the classic home until the flag is explicitly turned
 * on for a project, an organization, or a user.
 */
export const SIGNAL_FOCUSED_HOME_FLAG = "release_ui_home_signal_focused_enabled" as const;

/** Gate for signal-focused home rollout (spec: specs/home/signal-focused-home-rollout.feature). */
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
  const host = useProjectHomeHost();
  const project = host.project();
  const contextLoading = host.isLoading();
  // The host resolves the flag for the project AND the organization it is in.
  // Without the organization an org-targeted rollout rule can never match and
  // the whole organization silently stays on the classic home, which is why
  // the port asks for one answer rather than for the two ids.
  const { enabled, isLoading: flagLoading } = host.featureFlag(SIGNAL_FOCUSED_HOME_FLAG);
  return {
    show: enabled,
    // A reader with no project is decided, not pending — the flag query is
    // disabled for them and will never answer.
    isResolving: contextLoading || (!!project && flagLoading),
  };
}
