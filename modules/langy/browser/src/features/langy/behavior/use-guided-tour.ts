import { useUiDeclarations } from "@langwatch/browser-host/capabilities";
import type { UiGuidedTour } from "@langwatch/browser-host/declarations";

/** What a composition without onboarding reads: no tour, nothing to replay. */
const NO_TOUR: UiGuidedTour = { useRunning: () => false, useReplay: () => () => undefined };

/** The tour state onboarding lends, or none. Its members are hooks: call them during render. */
export function useGuidedTour(): UiGuidedTour {
  return useUiDeclarations().declared("guidedTour")[0]?.capability ?? NO_TOUR;
}
