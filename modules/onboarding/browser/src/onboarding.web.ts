/**
 * What a browser installs when it installs onboarding: the welcome flow,
 * the product-flavour flow and project creation.
 */

import { defineBrowserModule } from "@langwatch/browser";
import {
  FirstTouchAttributionToken,
  GuidedOnboardingOfferToken,
  GuidedPathActiveToken,
  GuidedTourStateToken,
  GuidedTourToken,
} from "@langwatch/onboarding-client";

import { onboardingFirstTouchAttribution } from "./behavior/first-touch-attribution.capability.ts";
import { onboardingGuidedPath } from "./features/guided-onboarding/behavior/guided-path-active.capability.ts";
import { onboardingGuidedTour } from "./features/guided-onboarding/behavior/guided-tour.capability.ts";
import { onboardingGuidedTourHooks } from "./features/guided-onboarding/behavior/guided-tour.lend.ts";

export const onboardingWeb = defineBrowserModule("onboarding")
  .withHosts({
    requires: ["OnboardingHostApi", "GuidedOnboardingHostApi"],
    mounts: {
      OnboardingHostApi: { load: () => import("./behavior/onboarding-host-mount.tsx") },
      GuidedOnboardingHostApi: {
        load: () =>
          import("./features/guided-onboarding/behavior/guided-onboarding-host-mount.tsx"),
      },
    },
  })
  .withScreens({
    "pages/onboarding": {
      path: "/onboarding",
      load: () => import("./ui/sections/onboarding/onboarding.screen.tsx"),
    },
    "pages/onboarding/welcome": {
      path: "/onboarding/welcome",
      load: () => import("./ui/sections/onboarding/welcome.screen.tsx"),
    },
    "pages/onboarding/product/index": {
      path: "/onboarding/product",
      load: () => import("./ui/sections/onboarding/product.screen.tsx"),
    },
    "pages/onboarding/[team]/project": {
      path: "/onboarding/:team/project",
      load: () => import("./ui/sections/onboarding/project.screen.tsx"),
    },
  })
  .lends(GuidedTourToken, { value: onboardingGuidedTourHooks })
  /** The tour's state for Langy's tour card, the guided path, and attribution for the shell. */
  .lends(GuidedTourStateToken, { value: onboardingGuidedTour })
  .lends(GuidedPathActiveToken, { value: onboardingGuidedPath })
  .lends(FirstTouchAttributionToken, { value: onboardingFirstTouchAttribution })
  .lends(GuidedOnboardingOfferToken, {
    load: () => import("./features/guided-onboarding/ui/home/guided-onboarding-offer.tsx"),
  });
