import { useProjectHomeHost } from "../../../../model/project-home-host.ts";
import { useSignalFocusedHomeVisibility } from "./use-show-signal-focused-home.ts";

/**
 * Which of the three home compositions renders: `signal-focused` (briefing
 * sheet leads), `langy` (command-bar home with a real composer), or
 * `classic` (banners, traces overview, recent work, onboarding).
 */
export type HomeComposition =
  | "signal-focused"
  | "langy"
  | "classic"
  /**
   * Not known yet. Every gate reports `false` while loading, so the page
   * would resolve to `classic`, paint it, then swap — the reader would watch
   * their home change shape on every cold load. One skeleton renders instead.
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
