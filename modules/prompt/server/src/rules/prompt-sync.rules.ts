import type { LatestConfigVersionSchema, VersionedPrompt } from "@langwatch/prompt-contract";

/**
 * The stored prompt as a local file would spell it, with every field the schema expects.
 * Optional sampling parameters are included only when defined, so an undefined value never
 * shows up as a false difference.
 */
export function remoteConfigDataOf(
  existingPrompt: VersionedPrompt,
): LatestConfigVersionSchema["configData"] {
  return {
    model: existingPrompt.model,
    prompt: existingPrompt.prompt,
    messages: existingPrompt.messages.filter((msg) => msg.role !== "system"),
    inputs: [...existingPrompt.inputs].sort((a, b) => {
      if (a.identifier === "input") {
        return -1;
      }

      if (b.identifier === "input") {
        return 1;
      }

      return a.identifier.localeCompare(b.identifier);
    }),
    outputs: existingPrompt.outputs,
    // response_format is derived from outputs, not stored separately
    // Include all sampling parameters only when defined
    ...(existingPrompt.temperature !== undefined && {
      temperature: existingPrompt.temperature,
    }),
    ...(existingPrompt.maxTokens !== undefined && {
      max_tokens: existingPrompt.maxTokens,
    }),
    ...(existingPrompt.topP !== undefined && {
      top_p: existingPrompt.topP,
    }),
    ...(existingPrompt.frequencyPenalty !== undefined && {
      frequency_penalty: existingPrompt.frequencyPenalty,
    }),
    ...(existingPrompt.presencePenalty !== undefined && {
      presence_penalty: existingPrompt.presencePenalty,
    }),
    ...(existingPrompt.seed !== undefined && {
      seed: existingPrompt.seed,
    }),
    ...(existingPrompt.topK !== undefined && {
      top_k: existingPrompt.topK,
    }),
    ...(existingPrompt.minP !== undefined && {
      min_p: existingPrompt.minP,
    }),
    ...(existingPrompt.repetitionPenalty !== undefined && {
      repetition_penalty: existingPrompt.repetitionPenalty,
    }),
    ...(existingPrompt.reasoning !== undefined && {
      reasoning: existingPrompt.reasoning,
    }),
    ...(existingPrompt.verbosity !== undefined && {
      verbosity: existingPrompt.verbosity,
    }),
  };
}
