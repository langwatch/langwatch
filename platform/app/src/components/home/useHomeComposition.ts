import { useLangyVisibility } from "~/features/langy/hooks/useShowLangy";
import { useSignalFocusedHomeVisibility } from "./useShowSignalFocusedHome";

/**
 * Which of the three home compositions renders.
 *
 * `signal-focused` is the briefing sheet leading the page, `langy` is the lit
 * block with a real composer in it — the command-bar home — `classic` is
 * banners + traces overview + recent work + onboarding.
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
 *   1. SIGNAL-FOCUSED wins outright. It is a deliberate alternative reading of
 *      the page and the two redesigns are not meant to compose; a project on
 *      its flag gets the briefing sheet, not a briefing sheet under a lit
 *      block.
 *   2. LANGY: having Langy is having the Langy home. The command-bar home IS
 *      part of what Langy brings — it used to hang off a second rollout flag
 *      of its own, which meant a project could have the panel and still be
 *      looking at the classic lobby, and nobody could say why from the page.
 *   3. CLASSIC otherwise.
 *
 * The waiting rule is encoded in the ORDER of the checks: an unanswered gate
 * blocks only the branches its answer could still change. Signal-focused is
 * asked first, so while it loads nothing is known; once it has won, Langy's
 * own gate is never waited on.
 *
 * Pure and separate from the hook so the ordering can be tested exhaustively
 * without mounting a page, a session or a feature-flag client. The hook below
 * only gathers the gates.
 *
 * Spec: specs/home/signal-focused-home-rollout.feature,
 *       specs/home/langy-home.feature
 */
export function resolveHomeComposition({
  showSignalFocusedHome,
  showLangy,
  signalFocusedResolving = false,
  langyResolving = false,
}: {
  showSignalFocusedHome: boolean;
  showLangy: boolean;
  /** The signal-focused rollout flag is still in flight. */
  signalFocusedResolving?: boolean;
  /** Langy's own visibility gate is still in flight. */
  langyResolving?: boolean;
}): HomeComposition {
  if (signalFocusedResolving) return "undecided";
  if (showSignalFocusedHome) return "signal-focused";
  if (langyResolving) return "undecided";
  if (showLangy) return "langy";
  return "classic";
}

/** The resolver, wired to the two real gates. */
export function useHomeComposition(): HomeComposition {
  const signalFocused = useSignalFocusedHomeVisibility();
  const langy = useLangyVisibility();

  return resolveHomeComposition({
    showSignalFocusedHome: signalFocused.show,
    showLangy: langy.show,
    signalFocusedResolving: signalFocused.isResolving,
    langyResolving: langy.isResolving,
  });
}
