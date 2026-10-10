/**
 * What a browser installs when it installs prompt: the Prompt Studio screen.
 */

import { defineBrowserModule } from "@langwatch/browser";
import {
  LlmConfigFieldToken,
  LlmConfigPopoverToken,
  OutputsSectionToken,
  PromptEditorDrawerToken,
  PromptListDrawerToken,
  StudioPromptEditorToken,
} from "@langwatch/prompt-client";
import { promptTagTrpc, promptTrpc } from "@langwatch/prompt-contract";

import { promptApi } from "./behavior/prompt-api.ts";

export const promptWeb = defineBrowserModule("prompt")
  .withApi(promptApi, { contracts: [promptTrpc, promptTagTrpc] })
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
  .drawer(PromptListDrawerToken, {
    load: async () => ({
      default: (await import("./ui/sections/prompt-list-drawer.tsx")).PromptListDrawer,
    }),
  })
  .drawer(PromptEditorDrawerToken, {
    load: async () => ({
      default: (await import("./ui/sections/prompts/prompt-editor-drawer.tsx")).PromptEditorDrawer,
    }),
  })
  /** The prompt editor and its fields, embedded headless in the studio's node panels (§10.1). */
  .lends(LlmConfigFieldToken, {
    load: async () => ({
      default: (await import("./ui/sections/prompts/lent-prompt-fields.tsx")).LentLlmConfigField,
    }),
  })
  .lends(LlmConfigPopoverToken, {
    load: async () => ({
      default: (await import("./ui/sections/prompts/lent-prompt-fields.tsx")).LentLlmConfigPopover,
    }),
  })
  .lends(OutputsSectionToken, {
    load: async () => ({
      default: (await import("./ui/sections/prompts/lent-prompt-fields.tsx")).LentOutputsSection,
    }),
  })
  .lends(StudioPromptEditorToken, {
    load: async () => ({
      default: (await import("./ui/sections/prompts/lent-studio-prompt-editor.tsx"))
        .LentStudioPromptEditor,
    }),
  });
