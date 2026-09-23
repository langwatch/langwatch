/**
 * What a browser installs when it installs model-provider: the Model
 * Providers and Model Costs settings screens, and the surfaces evaluator,
 * langy and trace mount today.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const modelProviderWeb = defineWebModule("model-provider")
  .withHosts({
    requires: ["ModelProviderHostApi"],
    mounts: {
      ModelProviderHostApi: { load: () => import("./behavior/model-provider-host-mount.tsx") },
    },
  })
  .withScreens({
    // Placed by the application's settings table until a settings anchor
    // accepts declared routes; the loader is this module's either way.
    "pages/settings/model-providers": {
      path: "/settings/model-providers",
      within: "settings",
      label: "Model Providers",
      load: () => import("./ui/sections/model-providers-screen.tsx"),
    },
    "pages/settings/model-costs": {
      path: "/settings/model-costs",
      within: "settings",
      label: "Model Costs",
      load: () => import("./ui/sections/model-costs-screen.tsx"),
    },
  })
  /** Lent, not kitted: both read this module's providers (§3.4 rule 7). */
  .withCapabilities({
    modelDisplay: {
      load: async () => ({
        default: (await import("./ui/elements/llm-model-display.tsx")).LLMModelDisplay,
      }),
    },
    modelSelector: {
      load: async () => ({
        default: (await import("./ui/elements/model-selector.tsx")).ModelSelector,
      }),
    },
  })
  /**
   * What another module may mount. langy edits providers inline; evaluator
   * and trace pick a model or read its cost/error surface.
   */
  .publishSurfaces({
    "ai-sparkles-loader": { load: () => import("@langwatch/model-provider-browser-kit") },
    "clamp-max-tokens": { load: () => import("@langwatch/model-provider-browser-kit") },
    "edit-model-provider-form": { load: () => import("./edit-model-provider-form.ts") },
    "history-icon": { load: () => import("@langwatch/model-provider-browser-kit") },
    "model-limits": { load: () => import("./model-limits.ts") },
    "no-models-configured-callout": {
      load: () => import("@langwatch/model-provider-browser-kit"),
    },
    "surfaces/model-error": { load: () => import("@langwatch/model-provider-browser-kit") },
    "surfaces/model-provider-settings": {
      load: () => import("./behavior/use-model-providers-settings.ts"),
    },
    "surfaces/model-selector": { load: () => import("./ui/elements/model-selector.tsx") },
    "surfaces/provider-model-selector": {
      load: () => import("@langwatch/model-provider-browser-kit"),
    },
  });
