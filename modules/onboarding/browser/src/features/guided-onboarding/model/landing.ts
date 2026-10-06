/**
 * Where each guided path lives in the product: the space its Home offer sits
 * in. Framework-free, like `paths.ts` on the contract.
 *
 * @see specs/features/onboarding/guided-tour.feature
 * @see specs/home/guided-onboarding-offer.feature
 */
import type { GuidedPath, GuidedSpace } from "@langwatch/onboarding-contract";

export type { GuidedSpace };

export const GUIDED_PATH_SPACE: Record<GuidedPath, GuidedSpace> = {
  llmops: "project",
  coding: "me",
  gateway: "gateway",
  governance: "governance",
};

export function guidedPathForSpace(space: GuidedSpace): GuidedPath {
  const entry = (Object.entries(GUIDED_PATH_SPACE) as [GuidedPath, GuidedSpace][]).find(
    ([, s]) => s === space,
  );
  // Every space has exactly one path; the table above is exhaustive.
  return entry![0];
}
