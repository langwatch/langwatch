/**
 * Screen loaders to defer code-gen bundling; owning feature mounts tRPC provider
 * and host port.
 */

import type { ComponentType } from "react";

export type OnboardingScreenLoader = () => Promise<{ default: ComponentType }>;

export const onboardingScreens = {
  onboarding: () => import("./ui/sections/onboarding/onboarding.screen.tsx"),
  welcome: () => import("./ui/sections/onboarding/welcome.screen.tsx"),
  product: () => import("./ui/sections/onboarding/product.screen.tsx"),
  project: () => import("./ui/sections/onboarding/project.screen.tsx"),
  setup: () => import("./ui/sections/onboarding/setup.screen.tsx"),
} as const satisfies Record<string, OnboardingScreenLoader>;

export type OnboardingScreenName = keyof typeof onboardingScreens;

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
