/**
 * Which page keys the onboarding addresses answer, and what they are wrapped in.
 *
 * FIVE KEYS, FIVE SCREENS, TWO DIFFERENT FRAMES — and the split is the family.
 *
 *   `/onboarding`, `/onboarding/welcome`, `/onboarding/product` and
 *   `/onboarding/:team/project` are OUTSIDE the application chrome, exactly where
 *   the route table puts them: these are the addresses a reader with no project
 *   reaches, and a project switcher above a page whose whole subject is not
 *   having one would be a control with nothing in it. They get the host and
 *   nothing else. `ui-outer-providers` already mounts `UiDesignSystemShell`
 *   above every route, so no page here needs a second one.
 *
 *   `/:project/setup` is inside the chrome, like every other project-scoped
 *   address, and it is the only key here that carries a guard: `project:view`.
 *
 * The other four keys carry no page-level grant — a grant is resolved against a
 * scope, and a reader arriving at `/onboarding/welcome` has none yet.
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
