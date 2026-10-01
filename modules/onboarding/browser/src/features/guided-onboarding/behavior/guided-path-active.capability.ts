/**
 * Whether a guided onboarding path is active, published for a peer screen —
 * the trace explorer's first-trace coach mark and the simulations welcome
 * card both stay quiet while one is being set up or its tour runs.
 * @see specs/features/onboarding/guided-tour.feature
 */
import { isGuidedPathActive } from "../model/guided-path-active.ts";
import { useGuidedTourStore } from "./guided-tour-store.ts";
import { useGuidedOnboarding } from "./use-guided-onboarding.ts";

export interface OnboardingGuidedPathCapability {
  /** A peer's screen reads this during render; the shell wires it through. */
  useIsActive: () => boolean;
}

export const onboardingGuidedPath: OnboardingGuidedPathCapability = {
  useIsActive: () => {
    const { state } = useGuidedOnboarding();
    const running = useGuidedTourStore((s) => s.running);
    return isGuidedPathActive({ state, tourRunning: running });
  },
};
