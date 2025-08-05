import { PromptFacade } from "./facade";

export { getPrompt } from "./get-prompt";
export { getPromptVersion } from "./get-prompt-version";
export {
  CompiledPrompt,
  Prompt,
  PromptCompilationError,
  type TemplateVariables,
} from "./prompt";

export const prompts = new PromptFacade();
