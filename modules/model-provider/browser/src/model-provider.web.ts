/**
 * What a browser installs when it installs model-provider: the Model
 * Providers and Model Costs settings screens, and the surfaces evaluator,
 * langy and trace mount today.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const modelProviderWeb = defineWebModule("model-provider")
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
  /**
   * What another module may mount. langy edits providers inline; evaluator
   * and trace pick a model or read its cost/error surface.
   */
  .publishSurfaces({
    "ai-sparkles-loader": { load: () => import("./ai-sparkles-loader.ts") },
    "clamp-max-tokens": { load: () => import("./clamp-max-tokens.ts") },
    "edit-model-provider-form": { load: () => import("./edit-model-provider-form.ts") },
    "history-icon": { load: () => import("./history-icon.ts") },
    "model-limits": { load: () => import("./model-limits.ts") },
    "no-models-configured-callout": { load: () => import("./no-models-configured-callout.ts") },
    "surfaces/model-error": { load: () => import("./model/model-error.ts") },
    "surfaces/model-provider-settings": {
      load: () => import("./behavior/use-model-providers-settings.ts"),
    },
    "surfaces/model-selector": { load: () => import("./ui/elements/model-selector.tsx") },
    "surfaces/provider-model-selector": {
      load: () => import("./ui/elements/provider-model-selector.tsx"),
    },
  });
