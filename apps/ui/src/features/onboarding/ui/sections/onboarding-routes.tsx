/**
 * Which page keys the onboarding addresses answer: four sit outside the
 * application chrome (no project yet, so no switcher and no grant);
 * `/:project/setup` is inside it, the only key here guarded by `project:view`.
 */

import { onboardingScreens } from "@langwatch/onboarding-web/screens/onboarding";
import type { ComponentType } from "react";
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { OnboardingHost } from "./onboarding-host";

export const onboardingPageLoaders: UiPageLoaderRegistry = {
  "pages/onboarding": uiPage({
    screen: onboardingScreens.onboarding,
    host: OnboardingHost,
  }),
  "pages/onboarding/welcome": uiPage({
    screen: onboardingScreens.welcome,
    host: OnboardingHost,
  }),
  "pages/onboarding/product/index": uiPage({
    screen: onboardingScreens.product,
    host: OnboardingHost,
  }),
  "pages/onboarding/[team]/project": uiPage({
    screen: onboardingScreens.project,
    host: OnboardingHost,
  }),
  "pages/[project]/setup": uiPage({
    screen: async () => ({ default: (await onboardingScreens.setup()).default as ComponentType }),
    host: OnboardingHost,
    permission: "project:view",
  }),
};
