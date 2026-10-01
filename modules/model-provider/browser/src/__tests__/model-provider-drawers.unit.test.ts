/** Settings and evaluator open these editors by drawer name; each must resolve to its editor. */

import { installedDrawerLoaders } from "@langwatch/browser";
import { describe, expect, it } from "vitest";

import { modelProviderWeb } from "../model-provider.web.ts";
import { DefaultModelOverrideDrawer } from "../ui/sections/default-model-override-drawer.tsx";
import { EditModelProviderDrawer } from "../ui/sections/edit-model-provider-drawer.tsx";
import { LLMModelCostDrawer } from "../ui/sections/llm-model-cost-drawer.tsx";

describe("given a browser that installs model-provider", () => {
  describe("when a surface opens the editModelProvider drawer", () => {
    /** @scenario "The model provider editor opens by its drawer name" */
    it("loads the provider editor", async () => {
      const loaded = await installedDrawerLoaders([modelProviderWeb]).editModelProvider?.();

      expect(loaded).toEqual({ default: EditModelProviderDrawer });
    });
  });

  describe("when a surface opens the defaultModelOverride drawer", () => {
    /** @scenario "The default model override editor opens by its drawer name" */
    it("loads the default model override editor", async () => {
      const loaded = await installedDrawerLoaders([modelProviderWeb]).defaultModelOverride?.();

      expect(loaded).toEqual({ default: DefaultModelOverrideDrawer });
    });
  });

  describe("when a surface opens the llmModelCost drawer", () => {
    /** @scenario "The model cost editor opens by its drawer name" */
    it("loads the model cost editor", async () => {
      const loaded = await installedDrawerLoaders([modelProviderWeb]).llmModelCost?.();

      expect(loaded).toEqual({ default: LLMModelCostDrawer });
    });
  });
});
