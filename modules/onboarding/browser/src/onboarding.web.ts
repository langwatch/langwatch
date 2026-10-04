/**
 * What a browser installs when it installs onboarding: the welcome flow,
 * the product-flavour flow and project creation.
 */

import { defineBrowserModule } from "@langwatch/browser";

import { onboardingFirstTouchAttribution } from "./behavior/first-touch-attribution.capability.ts";
import { onboardingGuidedPath } from "./features/guided-onboarding/behavior/guided-path-active.capability.ts";
import { onboardingGuidedTour } from "./features/guided-onboarding/behavior/guided-tour.capability.ts";

export const onboardingWeb = defineBrowserModule("onboarding")
  // The tour's state for Langy's tour card, the Home offer a screen draws in its own space,
  // and first-touch attribution for the shell.
  .withCapabilities({
    firstTouchAttribution: onboardingFirstTouchAttribution,
    guidedTour: onboardingGuidedTour,
    guidedPathActive: onboardingGuidedPath,
    guidedOnboardingOffer: {
      load: () => import("./features/guided-onboarding/ui/home/guided-onboarding-offer.tsx"),
    },
  })
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
    /** The in-project setup guide; the application's table owns the address. */
    "pages/[project]/setup": {
      requires: "project:view",
      load: () => import("./ui/sections/onboarding/setup.screen.tsx"),
    },
  });
