/** Prompt's editor, lent headless to the studio's signature panel (§3.4, rule 7). */

import type { UiStudioPromptEditorProps } from "@langwatch/browser-host/declarations";
import { useMemo } from "react";

import { nodeDataToLocalPromptConfig } from "../../../behavior/prompts/llm-prompt-config-utils.ts";
import { PromptEditorDrawer } from "./prompt-editor-drawer.tsx";

export function LentStudioPromptEditor({ nodeData, ...props }: UiStudioPromptEditorProps) {
  // The node's inline parameters, used only when the referenced prompt is not in this project.
  const inlineConfigFallback = useMemo(() => nodeDataToLocalPromptConfig(nodeData), [nodeData]);
  return (
    <PromptEditorDrawer headless={true} {...props} inlineConfigFallback={inlineConfigFallback} />
  );
}
