import { moduleApi } from "@langwatch/kernel/module-api";

import type { OnboardingVariant, GuidedOnboardingState } from "./onboarding-schemas.ts";

/** Every guided-onboarding write, scoped to the caller who made it. */
export type OnboardingCallerInput = Readonly<{ organizationId: string; userId: string }>;

export type GuidedOnboardingStateWithInstance = GuidedOnboardingState &
  Readonly<{ gatewayUrl?: string }>;

export type GuidedOnboardingStateWithVariant = GuidedOnboardingStateWithInstance &
  Readonly<{ variant: OnboardingVariant | null }>;

/** The onboarding capability. Operations arrive with the port of the process half. */
export interface OnboardingApi {
  getGuidedState(
    input: Readonly<{ organizationId: string; userId: string }>,
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
    input: OnboardingCallerInput & Readonly<{ path: string }>,
  ): Promise<GuidedOnboardingState>;
  attachConversation(
    input: OnboardingCallerInput & Readonly<{ conversationId: string }>,
  ): Promise<GuidedOnboardingState>;
}

export const OnboardingApi = moduleApi<OnboardingApi>()("onboarding");
