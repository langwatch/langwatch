/** What prompt lends the studio by token (ARCHITECTURE.md §10.1). */

import { Lent } from "@langwatch/browser-host/lent";
import {
  LlmConfigFieldToken,
  OutputsSectionToken,
  StudioPromptEditorToken,
  type LlmConfigFieldProps,
  type OutputsSectionProps,
  type StudioPromptEditorProps,
} from "@langwatch/prompt-client";

/** Prompt's editor, embedded in a signature node's panel. */
export function StudioPromptEditor(props: StudioPromptEditorProps) {
  return <Lent of={StudioPromptEditorToken} props={props} />;
}

/** Prompt's LLM config row, with the chosen model resolved by prompt. */
export function LLMConfigField(props: LlmConfigFieldProps) {
  return <Lent of={LlmConfigFieldToken} props={props} />;
}

/** Prompt's outputs editor. */
export function OutputsSection(props: OutputsSectionProps) {
  return <Lent of={OutputsSectionToken} props={props} />;
}
