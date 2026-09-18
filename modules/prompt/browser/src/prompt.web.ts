/**
 * What a browser installs when it installs prompt: the Prompt Studio screen.
 * `publishSurfaces` was superseded by the kit (ARCHITECTURE.md §14, ruled
 * 2026-09-18) and is deleted here, not repointed.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const promptWeb = defineWebModule("prompt")
  .withHosts({
    requires: ["PromptHostApi"],
    mounts: { PromptHostApi: { load: () => import("./behavior/prompt-host-mount.tsx") } },
  })
  .withScreens({
    "pages/[project]/prompts": {
      path: "/:project/prompts",
      within: "project",
      label: "Prompts",
      load: () => import("./ui/sections/prompt-studio/prompt-studio-screen.tsx"),
    },
  })
  .withDrawers({
    promptList: {
      load: async () => ({
        default: (await import("./ui/sections/prompt-list-drawer.tsx")).PromptListDrawer,
      }),
    },
  });
