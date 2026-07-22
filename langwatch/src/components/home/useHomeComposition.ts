import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useShowLangy } from "~/features/langy/hooks/useShowLangy";
import { useShowSignalFocusedHome } from "./useShowSignalFocusedHome";

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
export type HomeComposition = "signal-focused" | "langy" | "classic";

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
}: {
  showSignalFocusedHome: boolean;
  showLangy: boolean;
  langyHomeEnabled: boolean;
}): HomeComposition {
  if (showSignalFocusedHome) return "signal-focused";
  if (showLangy && langyHomeEnabled) return "langy";
  return "classic";
}

/** The resolver, wired to the three real gates. */
export function useHomeComposition(): HomeComposition {
  const showSignalFocusedHome = useShowSignalFocusedHome();
  const showLangy = useShowLangy();
  const { project, organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  // Only asked when it could matter: a reader without Langy can never get the
  // Langy home, so evaluating its rollout for them is a wasted round trip.
  const { enabled: langyHomeEnabled } = useFeatureFlag(LANGY_HOME_FLAG, {
    projectId: project?.id,
    organizationId: organization?.id,
    enabled: showLangy && !showSignalFocusedHome,
  });

  return resolveHomeComposition({
    showSignalFocusedHome,
    showLangy,
    langyHomeEnabled,
  });
}
