import type { WireVersionedPrompt } from "../wire-versioned-prompt.ts";
import { handleSchema } from "@langwatch/prompt-contract";

import { withDerivedDemonstrationColumns } from "./demonstration-columns.ts";
import { formSchema, type PromptConfigFormValues } from "@langwatch/prompt-contract";

/**
 * Strips only the scope prefix from a full handle path (`project_XXX/`,
 * `organization_XXX/`, or a 21-char nanoid prefix), preserving folder
 * structure: "project_ABC123/folder/gato" -> "folder/gato".
 */
const extractShortHandle = (handle: string | null | undefined): string | null => {
  if (!handle) return null;

  // Check for known prefixes: project_, org_, organization_
  const knownPrefixMatch = handle.match(/^(?:project_|organization_)[^/]+\//);
  if (knownPrefixMatch) {
    return handle.slice(knownPrefixMatch[0].length);
  }

  // Check for 21-character nanoid prefix (e.g., "iuc4aYIoL5YcI7imutYvl/gato")
  // Nanoids are alphanumeric, 21 chars, followed by /
  const nanoidPrefixMatch = handle.match(/^[a-zA-Z0-9_-]{21}\//);
  if (nanoidPrefixMatch) {
    return handle.slice(nanoidPrefixMatch[0].length);
  }

  // No scope prefix, return as-is
  return handle;
};

/**
 * Converts the versioned prompt to form values without the system message.
 */
export function versionedPromptToPromptConfigFormValues(
  prompt: WireVersionedPrompt,
): PromptConfigFormValues {
  /**
   * Extract short handle from full path (e.g., "project_ABC/gato" -> "gato")
   * The API may return full paths in some contexts (like version history)
   * but forms should use the short handle.
   */
  const shortHandle = extractShortHandle(prompt.handle);

  /**
   * Because we have old handles that are not valid,
   * we don't include them in the form values so it
   * basically forces them to be a "draft" and then the user
   * must resave the prompt to make it valid.
   */
  const isHandleValid = handleSchema.safeParse(shortHandle).success;

  return formSchema.parse({
    configId: prompt.id,
    versionMetadata: {
      versionId: prompt.versionId,
      versionNumber: prompt.version,
      versionCreatedAt: prompt.versionCreatedAt,
    },
    // Use short handle for form display
    handle: isHandleValid ? shortHandle : null,
    scope: prompt.scope,
    version: {
      parameters: prompt.parameters ?? {},
      configData: {
        prompt: prompt.prompt,
        // The system message should be stored in the prompt field in the DB,
        // so this shouldn't be necessary, but it's a precaution.
        messages: prompt.messages.filter((msg) => msg.role !== "system"),
        inputs: prompt.inputs,
        outputs: prompt.outputs,
        demonstrations: withDerivedDemonstrationColumns({
          demonstrations: prompt.demonstrations,
          inputs: prompt.inputs,
          outputs: prompt.outputs,
        }),
        promptingTechnique: prompt.promptingTechnique,
        responseFormat: prompt.responseFormat,
        llm: {
          model: prompt.model,
          temperature: prompt.temperature,
          maxTokens: prompt.maxTokens,
          // Traditional sampling parameters
          topP: prompt.topP,
          frequencyPenalty: prompt.frequencyPenalty,
          presencePenalty: prompt.presencePenalty,
          // Other sampling parameters
          seed: prompt.seed,
          topK: prompt.topK,
          minP: prompt.minP,
          repetitionPenalty: prompt.repetitionPenalty,
          // Reasoning parameter (canonical/unified field)
          reasoning: prompt.reasoning,
          verbosity: prompt.verbosity,
        },
      },
    },
  });
}

/**
 * Converts the versioned prompt to form values with the system message.
 * The system message is added to the messages array.
 */
export function versionedPromptToPromptConfigFormValuesWithSystemMessage(
  prompt: WireVersionedPrompt,
): PromptConfigFormValues {
  const base = versionedPromptToPromptConfigFormValues(prompt);

  if (prompt.prompt) {
    base.version.configData.messages = [
      { role: "system", content: prompt.prompt },
      ...base.version.configData.messages,
    ];
  }

  return base;
}
