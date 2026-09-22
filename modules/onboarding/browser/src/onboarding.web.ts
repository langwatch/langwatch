/**
 * What a browser installs when it installs onboarding: the welcome flow,
 * the product-flavour flow and project creation, plus the observability
 * surfaces trace and prompt mount inside their own onboarding panels.
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
  })
  /**
   * What another module may mount. trace mounts the SDK setup panels and
   * self-hosted endpoint copy; prompt mounts the API-snippet code preview.
   */
  .publishSurfaces({
    "surfaces/active-project-context": {
      load: () => import("./ui/sections/active-project-context.tsx"),
    },
    "surfaces/build-mcp-config": { load: () => import("./model/shared/build-mcp-config.ts") },
    "surfaces/code-preview": { load: () => import("./ui/sections/observability/code-preview.tsx") },
    "surfaces/docs-links": { load: () => import("./ui/blocks/observability/docs-links.tsx") },
    "surfaces/framework-grid": {
      load: () => import("./ui/sections/observability/framework-grid.tsx"),
    },
    "surfaces/framework-integration-code": {
      load: () => import("./ui/sections/observability/framework-integration-code.tsx"),
    },
    "surfaces/inline-copy-button": {
      load: () => import("./ui/sections/shared/inline-copy-button.tsx"),
    },
    "surfaces/install-preview": {
      load: () => import("./ui/sections/observability/install-preview.tsx"),
    },
    "surfaces/observability-codegen": {
      load: () => import("./ui/sections/observability/codegen/registry.tsx"),
    },
    "surfaces/observability-options": {
      load: () => import("./ui/sections/observability/ui-options.ts"),
    },
    "surfaces/observability-types": { load: () => import("./model/observability/types.ts") },
    "surfaces/onboarding-mesh-background": {
      load: () => import("./ui/elements/onboarding-mesh-background.tsx"),
    },
    "surfaces/platform-grid": {
      load: () => import("./ui/sections/observability/platform-grid.tsx"),
    },
    "surfaces/tech-stack": { load: () => import("./ui/blocks/tech-stack.tsx") },
    "surfaces/via-claude-code-screen": {
      load: () => import("./ui/sections/via-claude-code-screen.tsx"),
    },
    "surfaces/via-claude-desktop-screen": {
      load: () => import("./ui/sections/via-claude-desktop-screen.tsx"),
    },
  });
