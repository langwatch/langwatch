import type {
  GuidedOnboardingPath,
  GuidedOnboardingState,
} from "@/client-sdk/services/onboarding/onboarding-api.service";

/**
 * What the onboarding commands print. Langy runs them inside the panel, where
 * the output lands on a card the person reads, so it carries the picks, the
 * provider and where the tour stands, and nothing that is the platform's own:
 * no conversation id, no timestamps, no replay counter.
 */
export interface GuidedStateCard {
  paths: GuidedOnboardingPath[];
  currentPath?: GuidedOnboardingPath;
  donePaths: GuidedOnboardingPath[];
  provider?: string;
  providerModel?: string;
  tour: "completed" | "skipped" | "none";
}

export function guidedStateCard(state: GuidedOnboardingState): GuidedStateCard {
  return {
    paths: state.paths,
    ...(state.currentPath === undefined ? {} : { currentPath: state.currentPath }),
    donePaths: state.donePaths,
    ...(state.provider === undefined ? {} : { provider: state.provider }),
    ...(state.providerModel === undefined
      ? {}
      : { providerModel: state.providerModel }),
    tour: state.tourCompletedAt
      ? "completed"
      : state.tourSkippedAt
        ? "skipped"
        : "none",
  };
}
