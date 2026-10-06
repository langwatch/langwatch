/**
 * What a browser installs when it installs model-provider: the Model
 * Providers and Model Costs settings screens, their three drawers, and the
 * surfaces evaluator, langy and trace mount today.
 */

import { defineBrowserModule } from "@langwatch/browser";
import {
  EditModelProviderFormToken,
  ModelDisplayToken,
  ModelSelectorToken,
  modelProviderTrpc,
} from "@langwatch/model-provider-contract";

import { modelProviderApi } from "./behavior/model-provider-api.ts";
import { reportModelFailure } from "./ui/sections/model-failure-interceptor/index.ts";

export const modelProviderWeb = defineBrowserModule("model-provider")
  .withApi(modelProviderApi, { contracts: [modelProviderTrpc] })
  // specs/model-providers/missing-model-popup.feature
  .withFailureInterceptors([reportModelFailure])
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
  /** The names are the wire (§10): Settings and evaluator open these by address. */
  .withDrawers({
    editModelProvider: {
      load: async () => ({
        default: (await import("./ui/sections/edit-model-provider-drawer.tsx"))
          .EditModelProviderDrawer,
      }),
    },
    defaultModelOverride: {
      load: async () => ({
        default: (await import("./ui/sections/default-model-override-drawer.tsx"))
          .DefaultModelOverrideDrawer,
      }),
    },
    llmModelCost: {
      load: async () => ({
        default: (await import("./ui/sections/llm-model-cost-drawer.tsx")).LLMModelCostDrawer,
      }),
    },
  })
  .lends(EditModelProviderFormToken, {
    load: async () => ({
      default: (await import("./ui/sections/model-provider-form.tsx")).EditModelProviderForm,
    }),
  })
  .lends(ModelDisplayToken, {
    load: async () => ({
      default: (await import("./ui/elements/llm-model-display.tsx")).LLMModelDisplay,
    }),
  })
  .lends(ModelSelectorToken, {
    load: async () => ({
      default: (await import("./ui/elements/model-selector.tsx")).ModelSelector,
    }),
  });
