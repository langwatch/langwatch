/**
 * Onboarding: five screens in `@langwatch/onboarding-web`.
 * `revealProjectApiKey()` is how the setup guide gets a base key without
 * the scope graph ever carrying one.
 */

import { onboardingApi } from "@langwatch/onboarding-web/screens/onboarding";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { onboardingPageLoaders } from "./ui/sections/onboarding-routes";

export const onboardingApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/onboarding-web",
  api: onboardingApi,
});

export { onboardingPageLoaders };
