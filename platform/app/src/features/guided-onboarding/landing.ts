/**
 * Where each guided path lives in the product: the space its Home offer sits
 * in and the route the guided sign-up lands on.
 *
 * Framework-free, like `paths.ts`.
 *
 * @see specs/features/onboarding/guided-tour.feature
 * @see specs/home/guided-onboarding-offer.feature
 */
import type { GuidedPath } from "./paths";

/** The product space a path is set up in, keyed like `products.ts` ids. */
export type GuidedSpace = "project" | "me" | "gateway" | "governance";

export const GUIDED_PATH_SPACE: Record<GuidedPath, GuidedSpace> = {
  llmops: "project",
  coding: "me",
  gateway: "gateway",
  governance: "governance",
};

export function guidedPathForSpace(space: GuidedSpace): GuidedPath {
  const entry = (
    Object.entries(GUIDED_PATH_SPACE) as [GuidedPath, GuidedSpace][]
  ).find(([, s]) => s === space);
  // Every space has exactly one path; the table above is exhaustive.
  return entry![0];
}

/** The route the guided sign-up lands on for a path. */
export function guidedLandingRoute({
  path,
  projectSlug,
}: {
  path: GuidedPath;
  projectSlug: string;
}): string {
  switch (path) {
    case "llmops":
      return `/${projectSlug}/traces`;
    case "coding":
      return "/me";
    case "gateway":
      return "/gateway/virtual-keys";
    case "governance":
      return "/governance";
  }
}

/** The governance sources page the governance tour ends on. */
export const GOVERNANCE_SOURCES_ROUTE = "/governance/inventory?tab=sources";
