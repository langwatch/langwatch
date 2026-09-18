/**
 * What a browser installs when it installs prompt: the Prompt Studio
 * screen, and the surfaces evaluator, scenario, workflow and experiment
 * mount today.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const promptWeb = defineWebModule("prompt")
  .withScreens({
    "pages/[project]/prompts": {
      path: "/:project/prompts",
      within: "project",
      label: "Prompts",
      load: () => import("./ui/sections/prompt-studio/prompt-studio-screen.tsx"),
    },
  })
  /** What another module may mount: evaluator, scenario, workflow and experiment today. */
  .publishSurfaces({
    "llm-config-popover": { load: () => import("./llm-config-popover.ts") },
    "llm-config-field": { load: () => import("./llm-config-field.ts") },
    "llm-parameters": { load: () => import("./llm-parameters.ts") },
    "llm-prompt-config-utils": { load: () => import("./llm-prompt-config-utils.ts") },
    "outputs-section": { load: () => import("./outputs-section.ts") },
    "api-snippet": { load: () => import("./api-snippet.ts") },
    "prompt-version": { load: () => import("./prompt-version.ts") },
    "latest-prompt-version": { load: () => import("./latest-prompt-version.ts") },
    "surfaces/prompt-editor-drawer": {
      load: () => import("./ui/sections/prompts/prompt-editor-drawer.tsx"),
    },
  });
