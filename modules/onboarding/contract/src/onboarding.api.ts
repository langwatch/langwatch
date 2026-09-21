import { moduleApi } from "@langwatch/kernel/module-api";

/** The onboarding capability. Operations arrive with the port of the process half. */
export interface OnboardingApi {}

export const OnboardingApi = moduleApi<OnboardingApi>()("onboarding");
