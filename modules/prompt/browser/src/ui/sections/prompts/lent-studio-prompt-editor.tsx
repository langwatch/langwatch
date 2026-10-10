/** Prompt's editor, lent headless to the studio's signature panel (§3.4, rule 7). */

import type { StudioPromptEditorProps } from "@langwatch/prompt-client";
import { useMemo } from "react";

import { nodeDataToLocalPromptConfig } from "../../../model/prompt-node-conversion.ts";
import { PromptEditorDrawer } from "./prompt-editor-drawer.tsx";

export function LentStudioPromptEditor({ nodeData, ...props }: StudioPromptEditorProps) {
  // The node's inline parameters, used only when the referenced prompt is not in this project.
  const inlineConfigFallback = useMemo(() => nodeDataToLocalPromptConfig(nodeData), [nodeData]);
  return (
    <PromptEditorDrawer headless={true} {...props} inlineConfigFallback={inlineConfigFallback} />
  );
}
