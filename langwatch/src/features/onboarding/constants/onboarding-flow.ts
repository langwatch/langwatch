import { OnboardingScreenIndex, type OnboardingFlowConfig } from "../types/types";

export const ONBOARDING_FLOW_FULL: OnboardingFlowConfig = {
  variant: "full",
  visibleScreens: [
    OnboardingScreenIndex.ORGANIZATION,
    OnboardingScreenIndex.BASIC_INFO,
    OnboardingScreenIndex.DESIRES,
    OnboardingScreenIndex.ROLE,
  ],
  first: OnboardingScreenIndex.ORGANIZATION,
  last: OnboardingScreenIndex.ROLE,
  total: 4,
};

export const ONBOARDING_FLOW_SELF_HOSTED: OnboardingFlowConfig = {
  variant: "self_hosted",
  visibleScreens: [OnboardingScreenIndex.ORGANIZATION],
  first: OnboardingScreenIndex.ORGANIZATION,
  last: OnboardingScreenIndex.ORGANIZATION,
  total: 1,
};

export function getOnboardingFlowConfig(isSaaS: boolean): OnboardingFlowConfig {
  return isSaaS ? ONBOARDING_FLOW_FULL : ONBOARDING_FLOW_SELF_HOSTED;
}
