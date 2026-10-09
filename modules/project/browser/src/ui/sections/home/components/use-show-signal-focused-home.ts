import { useUiFlags } from "@langwatch/browser-host/feature-flag";
import { FrontendFlags } from "@langwatch/feature-flag-contract";

import { useProjectHomeHost } from "../../../../model/project-home-host.ts";
/**
 * The rollout flag the signal-focused home hangs off — the only lever that
 * switches composition. `defaultValue: false` keeps every project on
 * classic until the flag is turned on for a project, org, or user.
 */
export const SIGNAL_FOCUSED_HOME_FLAG = FrontendFlags.release_ui_home_signal_focused_enabled;

/**
 * Gate for signal-focused home rollout.
 * Spec: modules/project/specs/signal-focused-home-rollout.feature
 */
export function useShowSignalFocusedHome(): boolean {
  return useSignalFocusedHomeVisibility().show;
}

/**
 * The same gate, with its uncertainty exposed. `enabled` reads `false`
 * while the flag is in flight — right for hiding a control, wrong for
 * picking a page: this composition wins outright, so nothing else decides until it answers.
 */
export function useSignalFocusedHomeVisibility(): {
  show: boolean;
  isResolving: boolean;
} {
  const host = useProjectHomeHost();
  const project = host.project();
  const contextLoading = host.isLoading();
  // The shell's flags answer for the project AND its organization, so an
  // org-targeted rollout rule matches too.
  const flag = useUiFlags().flag(SIGNAL_FOCUSED_HOME_FLAG);
  const flagLoading = flag === void 0;
  return {
    show: flag === true,
    // A reader with no project is decided, not pending — the flag query is
    // disabled for them and will never answer.
    isResolving: contextLoading || (!!project && flagLoading),
  };
}
