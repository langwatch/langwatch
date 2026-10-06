import type {
  CioBatchCall,
  CioEventName,
  CioOrgTraits,
  CioPersonTraits,
} from "@langwatch/enterprise-nurturing-contract";
import {
  onboardingExperimentProperties,
  type GuidedOnboardingState,
  type GuidedPath,
  type OnboardingVariant,
} from "@langwatch/onboarding-contract";
import { nowInstant } from "@langwatch/time";

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
 * Decides the traits, the paths event and one campaign trigger per newly
 * picked path, so a path picked once never re-triggers.
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
}): CioBatchCall[] {
  const primaryPath = paths[0];
  const traits = {
    onboarding_variant: "guided",
    onboarding_paths: paths.join(","),
    ...(primaryPath ? { onboarding_primary_path: primaryPath } : {}),
  };

  const calls: CioBatchCall[] = [
    { type: "identify", userId, traits },
    { type: "group", userId, groupId: organizationId, traits },
  ];

  if (event === "paths_selected") {
    calls.push({
      type: "track",
      userId,
      event: "onboarding_paths_selected",
      properties: {
        paths: paths.join(","),
        ...(primaryPath ? { primary_path: primaryPath } : {}),
      },
    });
  }

  for (const path of paths) {
    if (previousPaths.includes(path)) continue;
    const campaignEvent = GUIDED_PATH_CAMPAIGN_EVENT[path];
    if (!campaignEvent) continue;
    calls.push({ type: "track", userId, event: campaignEvent, properties: { path } });
  }

  return calls;
}

/** Decides the provider connected, the tour outcome or each path completed call. */
export function fireGuidedOnboardingProgress({
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
    | "provider_skipped"
    | "tour_completed"
    | "tour_skipped"
    | "tour_replayed"
    | "path_completed";
  payload: Record<string, string | string[] | number | undefined>;
  state: GuidedOnboardingState;
}): CioBatchCall[] {
  switch (event) {
    case "provider_connected": {
      const provider = typeof payload.provider === "string" ? payload.provider : undefined;
      if (!provider) return [];
      return [{ type: "identify", userId, traits: { guided_onboarding_provider: provider } }];
    }
    case "tour_completed":
    case "tour_skipped": {
      return [
        {
          type: "identify",
          userId,
          traits: { guided_onboarding_tour: event === "tour_completed" ? "completed" : "skipped" },
        },
      ];
    }
    case "path_completed": {
      const completedPaths = state.donePaths.join(",");
      return [
        {
          type: "identify",
          userId,
          traits: {
            guided_onboarding_completed_paths: completedPaths,
            guided_onboarding_completed_at: nowInstant().toString({ fractionalSecondDigits: 3 }),
          },
        },
        {
          type: "group",
          userId,
          groupId: organizationId,
          traits: { guided_onboarding_completed_paths: completedPaths },
        },
        {
          type: "track",
          userId,
          event: "guided_onboarding_path_completed",
          properties: { path: payload.path },
        },
      ];
    }
    case "provider_skipped":
    case "tour_replayed":
      return [];
  }
}

type GuidedPostHogEventName =
  | "paths_selected"
  | "path_begun"
  | "provider_connected"
  | "provider_skipped"
  | "tour_completed"
  | "tour_skipped"
  | "tour_replayed"
  | "path_completed";

const POSTHOG_EVENT: Record<GuidedPostHogEventName, string> = {
  paths_selected: "guided_onboarding_paths_selected",
  path_begun: "guided_onboarding_path_begun",
  provider_connected: "guided_onboarding_provider_connected",
  provider_skipped: "guided_onboarding_provider_skipped",
  tour_completed: "guided_onboarding_tour_completed",
  tour_skipped: "guided_onboarding_tour_skipped",
  tour_replayed: "guided_onboarding_tour_replayed",
  path_completed: "guided_onboarding_path_completed",
};

/**
 * Only the named fields of the payload reach PostHog: nothing but the provider name and
 * the model may leave the process for a provider connection.
 */
function guidedPostHogProperties({
  event,
  payload,
  paths,
  currentPath,
}: {
  event: GuidedPostHogEventName;
  payload: Record<string, string | string[] | number | undefined>;
  paths: GuidedPath[];
  currentPath: GuidedPath | undefined;
}): Record<string, unknown> {
  switch (event) {
    case "paths_selected":
      return { paths, primary_path: paths[0] };
    case "provider_connected":
      return { provider: payload.provider, model: payload.model };
    case "tour_completed":
    case "tour_skipped":
    case "tour_replayed":
      return { path: currentPath };
    case "path_begun":
    case "path_completed":
      return { path: payload.path };
    case "provider_skipped":
      return {};
  }
}

/**
 * The PostHog event a guided write is tracked as: the step's own properties, the experiment
 * property, the organization, and the person properties the A/B split reads.
 */
export function fireGuidedOnboardingPostHog({
  userId,
  organizationId,
  event,
  payload,
  paths,
  currentPath,
}: {
  userId: string;
  organizationId: string;
  event: GuidedPostHogEventName;
  payload: Record<string, string | string[] | number | undefined>;
  paths: GuidedPath[];
  currentPath: GuidedPath | undefined;
}): { userId: string; event: string; properties: Record<string, unknown> } {
  return {
    userId,
    event: POSTHOG_EVENT[event],
    properties: {
      ...guidedPostHogProperties({ event, payload, paths, currentPath }),
      ...onboardingExperimentProperties("guided"),
      organization_id: organizationId,
      $set: {
        onboarding_variant: "guided",
        onboarding_paths: paths,
        onboarding_primary_path: paths[0],
      },
    },
  };
}
