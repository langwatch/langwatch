import type { GuidedPath } from "../../../../src/features/guided-onboarding/paths";
import { getApp } from "../../../../src/server/app-layer/app";
import type {
  GuidedOnboardingState,
  OnboardingVariant,
} from "../../../../src/server/schemas/sign-up-data.schema";
import { captureException } from "../../../../src/utils/posthogErrorCapture";
import type { CioEventName, CioOrgTraits, CioPersonTraits } from "../types";

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
  const tour = state.tourCompletedAt
    ? "completed"
    : state.tourSkippedAt
      ? "skipped"
      : undefined;
  return {
    onboarding_variant: variant,
    ...(state.paths.length > 0
      ? {
          onboarding_paths: state.paths.join(","),
          onboarding_primary_path: state.paths[0],
        }
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
      ? {
          onboarding_paths: state.paths.join(","),
          onboarding_primary_path: state.paths[0],
        }
      : {}),
    ...(state.donePaths.length > 0
      ? { guided_onboarding_completed_paths: state.donePaths.join(",") }
      : {}),
  };
}

/**
 * Fires the nurturing calls for the paths of a guided onboarding: the traits
 * on the person and the organization, the paths event when the picks were
 * made, and one campaign trigger per path that was not there before, so a
 * path picked on the value screen and a path begun later from the Home offer
 * each trigger its campaign exactly once.
 *
 * Fire-and-forget: never throws, never blocks the write.
 */
export function fireGuidedOnboardingPathsNurturing({
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
  const nurturing = getApp().nurturing;
  if (!nurturing) return;

  const primaryPath = paths[0];
  const traits = {
    onboarding_variant: "guided",
    onboarding_paths: paths.join(","),
    ...(primaryPath ? { onboarding_primary_path: primaryPath } : {}),
  };

  void nurturing.identifyUser({ userId, traits }).catch(captureException);

  void nurturing
    .groupUser({ userId, groupId: organizationId, traits })
    .catch(captureException);

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
      .catch(captureException);
  }

  for (const path of paths) {
    if (previousPaths.includes(path)) continue;
    void nurturing
      .trackEvent({
        userId,
        event: GUIDED_PATH_CAMPAIGN_EVENT[path],
        properties: { path },
      })
      .catch(captureException);
  }
}

/**
 * Fires the nurturing calls for the progress of a guided onboarding: the
 * provider once connected, how the tour ended, and each path completed with
 * its completion event.
 *
 * Fire-and-forget: never throws, never blocks the write.
 */
export function fireGuidedOnboardingProgressNurturing({
  userId,
  organizationId,
  event,
  payload,
  state,
}: {
  userId: string;
  organizationId: string;
  event:
    | "provider_connected"
    | "tour_completed"
    | "tour_skipped"
    | "path_completed";
  payload: Record<string, string | string[] | number | undefined>;
  state: GuidedOnboardingState;
}): void {
  const nurturing = getApp().nurturing;
  if (!nurturing) return;

  switch (event) {
    case "provider_connected": {
      const provider =
        typeof payload.provider === "string" ? payload.provider : undefined;
      if (!provider) return;
      void nurturing
        .identifyUser({
          userId,
          traits: { guided_onboarding_provider: provider },
        })
        .catch(captureException);
      return;
    }
    case "tour_completed":
    case "tour_skipped": {
      void nurturing
        .identifyUser({
          userId,
          traits: {
            guided_onboarding_tour:
              event === "tour_completed" ? "completed" : "skipped",
          },
        })
        .catch(captureException);
      return;
    }
    case "path_completed": {
      const completedPaths = state.donePaths.join(",");
      void nurturing
        .identifyUser({
          userId,
          traits: {
            guided_onboarding_completed_paths: completedPaths,
            guided_onboarding_completed_at: new Date().toISOString(),
          },
        })
        .catch(captureException);
      void nurturing
        .groupUser({
          userId,
          groupId: organizationId,
          traits: { guided_onboarding_completed_paths: completedPaths },
        })
        .catch(captureException);
      void nurturing
        .trackEvent({
          userId,
          event: "guided_onboarding_path_completed",
          properties: { path: payload.path },
        })
        .catch(captureException);
      return;
    }
  }
}
