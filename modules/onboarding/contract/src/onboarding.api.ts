import { HandledError } from "@langwatch/handled-error";
import { moduleApi } from "@langwatch/module";

import { GUIDED_PATHS } from "./onboarding-guided-paths.ts";
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
}

export const OnboardingApi = moduleApi<OnboardingApi>()("onboarding");

/**
 * Handled errors of the guided onboarding (ADR-045): the failures a caller
 * can act on. A path name outside the four the product knows is the one the
 * CLI can produce, since it takes the path as free text.
 */

export class GuidedOnboardingPathUnknownError extends HandledError {
  declare readonly code: "guided_onboarding_path_unknown";

  constructor(path: string) {
    super("guided_onboarding_path_unknown", `Unknown onboarding path: ${path}`, {
      httpStatus: 422,
      fault: "customer",
      meta: { path, knownPaths: [...GUIDED_PATHS] },
    });
    this.name = "GuidedOnboardingPathUnknownError";
  }
}
