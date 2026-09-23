/**
 * What a browser installs when it installs onboarding: the welcome flow,
 * the product-flavour flow and project creation.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

import { onboardingGuidedPath } from "./features/guided-onboarding/behavior/guided-path-active.capability.ts";

export const onboardingWeb = defineWebModule("onboarding")
  // Whether a guided path is active; a peer screen's own host reads this
  // through the shell, so the simulations welcome card and similar coach
  // marks stay quiet without importing onboarding's private state.
  .withCapabilities({ guidedPath: onboardingGuidedPath })
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
      load: () => import("./ui/sections/onboarding/setup.screen.tsx"),
    },
  });
