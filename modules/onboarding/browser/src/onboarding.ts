/**
 * Screen loaders to defer code-gen bundling; owning feature mounts tRPC provider
 * and host port.
 */

export { onboardingApi } from "./behavior/onboarding-api.ts";
export {
  OnboardingHostApi,
  OnboardingHostProvider,
  type OnboardingActor,
  type OnboardingFailureNotice,
  type OnboardingFlagReading,
  type OnboardingOrganization,
  type OnboardingProject,
  type OnboardingRouteReading,
  type OnboardingScope,
  type OnboardingSessionStatus,
  type OnboardingSuccessNotice,
  type OnboardingTeam,
} from "./model/onboarding-host.ts";
