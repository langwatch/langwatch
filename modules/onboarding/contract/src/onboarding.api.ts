import { moduleApi } from "@langwatch/module";

import type { OnboardingVariant, GuidedOnboardingState } from "./onboarding-schemas.ts";
import type { OrganizationInitialized } from "./onboarding.responses.ts";
import type {
  OnboardingInitializeOrganizationInput,
  OnboardingIntegrationMethod,
} from "./onboarding.trpc.ts";

/** Every guided-onboarding write, scoped to the caller who made it. */
export type OnboardingCallerInput = Readonly<{ organizationId: string; userId: string }>;

/** The signed-in person a sign-up runs for, as their session carries them. */
export type OnboardingSignUpCaller = Readonly<{
  id: string;
  name: string | null;
  email: string | null;
}>;

export type GuidedOnboardingStateWithInstance = GuidedOnboardingState &
  Readonly<{ gatewayUrl?: string }>;

export type GuidedOnboardingStateWithVariant = GuidedOnboardingStateWithInstance &
  Readonly<{ variant: OnboardingVariant | null }>;

/** The guided onboarding of the organization behind a project, read with no caller to authorize. */
export type GuidedOnboardingForProject = Readonly<{
  organizationId: string;
  variant: OnboardingVariant | null;
  state: GuidedOnboardingState;
}>;

/** One product-analytics event about guided onboarding, tracked against a person. */
export type GuidedOnboardingTrackedEvent = Readonly<{
  userId: string;
  event: string;
  projectId?: string;
  properties: Readonly<Record<string, unknown>>;
  /** The same for every delivery of one source event, so the sink keeps one. */
  uuid?: string;
}>;

/** The onboarding capability. Operations arrive with the port of the process half. */
export interface OnboardingApi {
  getGuidedState(
    input: Readonly<{ organizationId: string; userId: string | null }>,
  ): Promise<GuidedOnboardingStateWithVariant>;
  recordPaths(
    input: OnboardingCallerInput & Readonly<{ paths: readonly string[] }>,
  ): Promise<GuidedOnboardingState>;
  recordProvider(
    input: OnboardingCallerInput & Readonly<{ provider: string; model: string }>,
  ): Promise<GuidedOnboardingState>;
  recordProviderSkipped(input: OnboardingCallerInput): Promise<GuidedOnboardingState>;
  recordVirtualKeyReveal(
    input: OnboardingCallerInput & Readonly<{ name: string; preview: string; revealId: string }>,
  ): Promise<GuidedOnboardingState>;
  recordTour(
    input: OnboardingCallerInput & Readonly<{ status: "completed" | "skipped" | "replayed" }>,
  ): Promise<GuidedOnboardingState>;
  beginPath(
    input: OnboardingCallerInput & Readonly<{ path: string }>,
  ): Promise<GuidedOnboardingStateWithInstance>;
  completePath(
    input: Readonly<{ organizationId: string; userId: string | null; path: string }>,
  ): Promise<GuidedOnboardingState>;
  attachConversation(
    input: OnboardingCallerInput & Readonly<{ conversationId: string }>,
  ): Promise<GuidedOnboardingState>;
  /** The sign-up ceremony; the organization module carries it out. */
  initializeOrganization(
    input: OnboardingInitializeOrganizationInput,
    by: OnboardingSignUpCaller,
  ): Promise<OrganizationInitialized>;
  recordIntegrationMethod(
    input: Readonly<{ userId: string; selection: OnboardingIntegrationMethod }>,
  ): void;
  /** Throws `project_not_found` when the project is gone. */
  getGuidedStateByProject(
    input: Readonly<{ projectId: string }>,
  ): Promise<GuidedOnboardingForProject>;
  /** Fire and forget: the reaction that tracks it must not fail on it. */
  trackGuidedOnboardingEvent(input: GuidedOnboardingTrackedEvent): void;
}

export const OnboardingApi = moduleApi<OnboardingApi>()("onboarding");
