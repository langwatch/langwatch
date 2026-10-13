import type { PromptData } from "./types";

/** Picks the schema fields of a prompt, leaving its methods and extra fields behind. */
export function promptDataOf(prompt: PromptData): PromptData {
  return {
    model: prompt.model,
    messages: prompt.messages,
    prompt: prompt.prompt,
    temperature: prompt.temperature,
    maxTokens: prompt.maxTokens,
    responseFormat: prompt.responseFormat,
    id: prompt.id,
    handle: prompt.handle,
    version: prompt.version,
    versionId: prompt.versionId,
    scope: prompt.scope,
    parameters: prompt.parameters,
  };
}
