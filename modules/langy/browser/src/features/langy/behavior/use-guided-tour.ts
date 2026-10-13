import { useLentHooks } from "@langwatch/browser-host/lent";
import { GuidedTourStateToken, type GuidedTourState } from "@langwatch/onboarding-client";

/** What a composition without onboarding reads: no tour, nothing to replay. */
const NO_TOUR: GuidedTourState = { useRunning: () => false, useReplay: () => () => undefined };

/** The tour state onboarding lends, or none. Its members are hooks: call them during render. */
export function useGuidedTour(): GuidedTourState {
  return useLentHooks(GuidedTourStateToken) ?? NO_TOUR;
}
