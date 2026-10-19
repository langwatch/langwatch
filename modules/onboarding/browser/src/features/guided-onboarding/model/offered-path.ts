/**
 * The path a space's home offer starts, or none: the offer is for an organization in the guided
 * variant, in a space nothing is guiding yet, whose path is not already done.
 * @see specs/home/guided-onboarding-offer.feature
 */
import type { GuidedOnboardingStateWithVariant, GuidedPath } from "@langwatch/onboarding-contract";

import { type GuidedSpace, guidedPathForSpace } from "./landing.ts";

export function offeredPath({
  space,
  state,
}: {
  space: GuidedSpace;
  state: Pick<GuidedOnboardingStateWithVariant, "variant" | "currentPath" | "donePaths">;
}): GuidedPath | null {
  if (state.variant !== "guided") return null;
  const path = guidedPathForSpace(space);
  if (state.currentPath === path) return null;
  if (state.donePaths.includes(path)) return null;
  return path;
}
