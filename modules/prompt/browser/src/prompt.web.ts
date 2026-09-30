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
      requires: "prompts:view",
      load: () => import("./ui/sections/prompt-studio/prompt-studio-screen.tsx"),
    },
  })
  .withDrawers({
    promptList: {
      load: async () => ({
        default: (await import("./ui/sections/prompt-list-drawer.tsx")).PromptListDrawer,
      }),
    },
    promptEditor: {
      load: async () => ({
        default: (await import("./ui/sections/prompts/prompt-editor-drawer.tsx"))
          .PromptEditorDrawer,
      }),
    },
  })
  /** The prompt editor, embedded headless in the studio's signature node panel (§3.4 rule 7). */
  .withCapabilities({
    llmConfigField: {
      load: async () => ({
        default: (await import("./ui/sections/prompts/lent-prompt-fields.tsx")).LentLlmConfigField,
      }),
    },
    llmConfigPopover: {
      load: async () => ({
        default: (await import("./ui/sections/prompts/lent-prompt-fields.tsx"))
          .LentLlmConfigPopover,
      }),
    },
    outputsSection: {
      load: async () => ({
        default: (await import("./ui/sections/prompts/lent-prompt-fields.tsx")).LentOutputsSection,
      }),
    },
    studioPromptEditor: {
      load: async () => ({
        default: (await import("./ui/sections/prompts/lent-studio-prompt-editor.tsx"))
          .LentStudioPromptEditor,
      }),
    },
  });
