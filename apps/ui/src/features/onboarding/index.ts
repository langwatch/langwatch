/**
 * The onboarding family, as this application composes it.
 *
 * The five screens live in `@langwatch/onboarding-web`; what belongs to the
 * application is which page keys the addresses answer, the transport their hooks
 * run on, and the host port that turns this application's capabilities into the
 * questions the family asks — including `revealProjectApiKey()`, which is how the
 * setup guide gets a base key without the scope graph ever carrying one.
 */

import { onboardingApi } from "@langwatch/onboarding-web/screens/onboarding";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { onboardingPageLoaders } from "./ui/sections/onboarding-routes";

export const onboardingApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/onboarding-web",
  api: onboardingApi,
});

export { onboardingPageLoaders };
