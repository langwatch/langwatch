/**
 * Onboarding: five screens in `@langwatch/onboarding-web`.
 * `revealProjectApiKey()` is how the setup guide gets a base key without
 * the scope graph ever carrying one.
 */

import { onboardingApi } from "@langwatch/onboarding-web/screens/onboarding";
import { uiFeature } from "../../behavior/ui-feature";
import { onboardingPageLoaders } from "./ui/sections/onboarding-routes";

export const onboardingFeature = uiFeature({
  name: "@langwatch/onboarding-web",
  api: onboardingApi,
  loaders: onboardingPageLoaders,
});
