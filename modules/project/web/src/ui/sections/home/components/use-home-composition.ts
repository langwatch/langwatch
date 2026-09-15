import { useSignalFocusedHomeVisibility } from "./use-show-signal-focused-home.ts";
import { useProjectHomeHost } from "../../../../model/project-home-host.ts";

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
 * Precedence rule: signal-focused wins outright, then langy, then classic.
 * Pure function; check order gates waiting: unanswered gates block only
 * branches their answer could change.
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
  const langy = useProjectHomeHost().langyVisibility();

  return resolveHomeComposition({
    showSignalFocusedHome: signalFocused.show,
    showLangy: langy.show,
    signalFocusedResolving: signalFocused.isResolving,
    langyResolving: langy.isResolving,
  });
}
