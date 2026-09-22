import type {
  CioEventName,
  CioOrgTraits,
  CioPersonTraits,
} from "@langwatch/enterprise-billing-contract";
import type {
  GuidedOnboardingState,
  GuidedPath,
  OnboardingVariant,
} from "@langwatch/onboarding-contract";
import { nowInstant } from "@langwatch/time";

import { findSink, reportFailure } from "./nurturing-sink-registry-service.rules.ts";

/**
 * One campaign trigger per path. Marketing runs one campaign off each of
 * these, so the names are part of the contract with Customer.io and never
 * change with the path enum.
 */
export const GUIDED_PATH_CAMPAIGN_EVENT: Record<GuidedPath, CioEventName> = {
  llmops: "onboarding_path_llmops",
  coding: "onboarding_path_coding_agents",
  gateway: "onboarding_path_gateway",
  governance: "onboarding_path_governance",
};

/**
 * The person traits a guided onboarding state reads as, used both by the
 * live hooks and by the first-login backfill. Only what the state carries is
 * returned, so a trait never resets to an empty value.
 */
export function guidedOnboardingPersonTraits({
  variant,
  state,
}: {
  variant: OnboardingVariant;
  state: GuidedOnboardingState;
}): Partial<CioPersonTraits> {
  let tour: "completed" | "skipped" | undefined;
  if (state.tourCompletedAt) tour = "completed";
  else if (state.tourSkippedAt) tour = "skipped";
  return {
    onboarding_variant: variant,
    ...(state.paths.length > 0
      ? { onboarding_paths: state.paths.join(","), onboarding_primary_path: state.paths[0] }
      : {}),
    ...(state.provider ? { guided_onboarding_provider: state.provider } : {}),
    ...(tour ? { guided_onboarding_tour: tour } : {}),
    ...(state.donePaths.length > 0
      ? { guided_onboarding_completed_paths: state.donePaths.join(",") }
      : {}),
  };
}

/** The organization traits a guided onboarding state reads as. */
export function guidedOnboardingOrgTraits({
  variant,
  state,
}: {
  variant: OnboardingVariant;
  state: GuidedOnboardingState;
}): Partial<CioOrgTraits> {
  return {
    onboarding_variant: variant,
    ...(state.paths.length > 0
      ? { onboarding_paths: state.paths.join(","), onboarding_primary_path: state.paths[0] }
      : {}),
    ...(state.donePaths.length > 0
      ? { guided_onboarding_completed_paths: state.donePaths.join(",") }
      : {}),
  };
}

/**
 * Fires the traits, the paths event and one campaign trigger per newly
 * picked path, so a path picked once never re-triggers. Fire-and-forget.
 */
export function fireGuidedOnboardingPaths({
  userId,
  organizationId,
  event,
  previousPaths,
  paths,
}: {
  userId: string;
  organizationId: string;
  event: "paths_selected" | "path_begun";
  previousPaths: GuidedPath[];
  paths: GuidedPath[];
}): void {
  const nurturing = findSink();
  if (!nurturing) return;

  const primaryPath = paths[0];
  const traits = {
    onboarding_variant: "guided",
    onboarding_paths: paths.join(","),
    ...(primaryPath ? { onboarding_primary_path: primaryPath } : {}),
  };

  void nurturing.identifyUser({ userId, traits }).catch(reportFailure);
  void nurturing.groupUser({ userId, groupId: organizationId, traits }).catch(reportFailure);

  if (event === "paths_selected") {
    void nurturing
      .trackEvent({
        userId,
        event: "onboarding_paths_selected",
        properties: {
          paths: paths.join(","),
          ...(primaryPath ? { primary_path: primaryPath } : {}),
        },
      })
      .catch(reportFailure);
  }

  for (const path of paths) {
    if (previousPaths.includes(path)) continue;
    const campaignEvent = GUIDED_PATH_CAMPAIGN_EVENT[path];
    if (!campaignEvent) continue;
    void nurturing
      .trackEvent({ userId, event: campaignEvent, properties: { path } })
      .catch(reportFailure);
  }
}

/** Fires the provider connected, the tour outcome and each path completed. Fire-and-forget. */
export function fireGuidedOnboardingProgress({
  userId,
  organizationId,
  event,
  payload,
  state,
}: {
  userId: string;
  organizationId: string;
  event: "provider_connected" | "tour_completed" | "tour_skipped" | "path_completed";
  payload: Record<string, string | string[] | number | undefined>;
  state: GuidedOnboardingState;
}): void {
  const nurturing = findSink();
  if (!nurturing) return;

  switch (event) {
    case "provider_connected": {
      const provider = typeof payload.provider === "string" ? payload.provider : undefined;
      if (!provider) return;
      void nurturing
        .identifyUser({ userId, traits: { guided_onboarding_provider: provider } })
        .catch(reportFailure);
      return;
    }
    case "tour_completed":
    case "tour_skipped": {
      void nurturing
        .identifyUser({
          userId,
          traits: { guided_onboarding_tour: event === "tour_completed" ? "completed" : "skipped" },
        })
        .catch(reportFailure);
      return;
    }
    case "path_completed": {
      const completedPaths = state.donePaths.join(",");
      void nurturing
        .identifyUser({
          userId,
          traits: {
            guided_onboarding_completed_paths: completedPaths,
            guided_onboarding_completed_at: nowInstant().toString({ fractionalSecondDigits: 3 }),
          },
        })
        .catch(reportFailure);
      void nurturing
        .groupUser({
          userId,
          groupId: organizationId,
          traits: { guided_onboarding_completed_paths: completedPaths },
        })
        .catch(reportFailure);
      void nurturing
        .trackEvent({
          userId,
          event: "guided_onboarding_path_completed",
          properties: { path: payload.path },
        })
        .catch(reportFailure);
      return;
    }
  }
}
