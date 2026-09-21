/**
 * Whether a guided onboarding path is set up right now: the tour is running,
 * or a path is current and not done. @see specs/features/onboarding/guided-tour.feature
 */
import type { GuidedOnboardingState } from "@langwatch/onboarding-contract";

export function isGuidedPathActive({
  state,
  tourRunning,
}: {
  state: Pick<GuidedOnboardingState, "currentPath" | "donePaths"> | null;
  tourRunning: boolean;
}): boolean {
  if (tourRunning) return true;
  const current = state?.currentPath;
  if (!current) return false;
  return !state.donePaths.includes(current);
}
