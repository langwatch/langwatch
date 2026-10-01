import { useProjectHomeHost } from "../../../../model/project-home-host.ts";

/**
 * Which home composition renders: `langy` (command-bar home with a real
 * composer) or `classic` (banners, traces overview, recent work, onboarding).
 */
export type HomeComposition =
  | "langy"
  | "classic"
  /**
   * Not known yet. The gate reports `false` while loading, so the page would
   * resolve to `classic`, paint it, then swap — the reader would watch their
   * home change shape on every cold load. One skeleton renders instead.
   */
  | "undecided";

/** Having Langy is having the Langy home; nothing is decided while the gate is in flight. */
export function resolveHomeComposition({
  showLangy,
  langyResolving = false,
}: {
  showLangy: boolean;
  /** Langy's own visibility gate is still in flight. */
  langyResolving?: boolean;
}): HomeComposition {
  if (langyResolving) return "undecided";
  if (showLangy) return "langy";
  return "classic";
}

/** The resolver, wired to the real gate. */
export function useHomeComposition(): HomeComposition {
  const langy = useProjectHomeHost().langyVisibility();

  return resolveHomeComposition({
    showLangy: langy.show,
    langyResolving: langy.isResolving,
  });
}
