/**
 * Whether a guided onboarding path is being set up right now: the tour is
 * running, or a path is current and not yet done. Langy navigates the pages
 * while it works, and the pages' own coach marks stay quiet meanwhile.
 *
 * @see specs/features/onboarding/guided-tour.feature
 */
import type { GuidedOnboardingState } from "~/server/schemas/sign-up-data.schema";
import { useGuidedTourStore } from "./tour/guidedTourStore";
import { useGuidedOnboarding } from "./useGuidedOnboarding";

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

export function useGuidedPathActive(): boolean {
  const { guided, state } = useGuidedOnboarding();
  const tourRunning = useGuidedTourStore((tour) => tour.running);
  return isGuidedPathActive({ state: guided ? state : null, tourRunning });
}
