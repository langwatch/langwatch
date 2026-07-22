import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useLangyVisibility } from "~/features/langy/hooks/useShowLangy";
import { useSignalFocusedHomeVisibility } from "./useShowSignalFocusedHome";

/**
 * The rollout flag the Langy home hangs off. Registered with
 * `defaultValue: false`, and deliberately SEPARATE from Langy's own release
 * flag: shipping the panel to a project must not silently reshape its home
 * page, so this one is turned on independently.
 */
export const LANGY_HOME_FLAG = "release_ui_home_langy_lantern_enabled" as const;

/**
 * Which of the three home compositions renders.
 *
 * `signal-focused` is the briefing sheet leading the page, `langy` is the lit
 * block with a real composer in it, `classic` is banners + traces overview +
 * recent work + onboarding.
 */
export type HomeComposition =
  | "signal-focused"
  | "langy"
  | "classic"
  /**
   * Not known yet. Every gate below reports `false` while it loads, so the
   * page would otherwise resolve to `classic`, paint it, and then swap to the
   * real composition a beat later — the reader watches their home page change
   * shape under them on every cold load. The page renders one skeleton for
   * this and commits to nothing.
   */
  | "undecided";

/**
 * The precedence rule itself, as a pure function.
 *
 * Strict order, and the order is the whole point:
 *
 *   1. SIGNAL-FOCUSED wins outright. It is the newest reading of the page and
 *      the two redesigns are not meant to compose; a project on both flags
 *      gets the briefing sheet, not a briefing sheet under a lit block.
 *   2. LANGY needs BOTH Langy access and its own rollout. Access alone is not
 *      enough, or every project that ever got the panel would have had its
 *      home page change shape underneath it.
 *   3. CLASSIC otherwise.
 *
 * Pure and separate from the hook so the ordering can be tested exhaustively
 * without mounting a page, a session or a feature-flag client. The hook below
 * only gathers the three booleans.
 *
 * Spec: specs/home/signal-focused-home-rollout.feature,
 *       specs/home/langy-home.feature
 */
export function resolveHomeComposition({
  showSignalFocusedHome,
  showLangy,
  langyHomeEnabled,
  isResolving = false,
}: {
  showSignalFocusedHome: boolean;
  showLangy: boolean;
  langyHomeEnabled: boolean;
  /** Any gate this answer depends on is still in flight. */
  isResolving?: boolean;
}): HomeComposition {
  // Before precedence, because an unknown gate makes every branch below a
  // guess — and a guess here is a page the reader watches get replaced.
  if (isResolving) return "undecided";
  if (showSignalFocusedHome) return "signal-focused";
  if (showLangy && langyHomeEnabled) return "langy";
  return "classic";
}

/** The resolver, wired to the three real gates. */
export function useHomeComposition(): HomeComposition {
  const signalFocused = useSignalFocusedHomeVisibility();
  const langy = useLangyVisibility();
  const { project, organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  // Only asked when it could matter: a reader without Langy can never get the
  // Langy home, so evaluating its rollout for them is a wasted round trip.
  const { enabled: langyHomeEnabled, isLoading: langyHomeLoading } =
    useFeatureFlag(LANGY_HOME_FLAG, {
      projectId: project?.id,
      organizationId: organization?.id,
      enabled: langy.show && !signalFocused.show,
    });

  // Follows the precedence exactly, so the page never waits on a gate whose
  // answer could not change the outcome: once signal-focused has won, nothing
  // below it is asked, and a reader without Langy never waits on the Langy
  // home's rollout.
  const langyHomeAsked = langy.show && !signalFocused.show;
  const isResolving =
    signalFocused.isResolving ||
    (!signalFocused.show &&
      (langy.isResolving || (langyHomeAsked && langyHomeLoading)));

  return resolveHomeComposition({
    showSignalFocusedHome: signalFocused.show,
    showLangy: langy.show,
    langyHomeEnabled,
    isResolving,
  });
}
