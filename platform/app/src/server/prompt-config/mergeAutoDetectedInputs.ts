import type { LlmConfigInputType } from "~/types";
import { extractLiquidVariables } from "~/utils/liquid/liquidTokenizer";

interface PromptInput {
  identifier: string;
  type: LlmConfigInputType;
}

const addLiquidVariables = (target: Set<string>, text: string): void => {
  const { inputVariables } = extractLiquidVariables(text);
  for (const name of inputVariables) {
    target.add(name);
  }
};

const detectTemplateVariables = ({
  prompt,
  messages,
}: {
  prompt: string;
  messages: Array<{ role: string; content: string }>;
}): Set<string> => {
  const detectedNames = new Set<string>();

  // Extract from prompt text
  if (prompt) {
    addLiquidVariables(detectedNames, prompt);
  }

  // Extract from all message contents
  for (const message of messages) {
    if (message.content) {
      addLiquidVariables(detectedNames, message.content);
    }
  }

  return detectedNames;
};

// "input" first (locked variable), then alphabetically
const byLockedInputThenAlphabetical = (
  a: PromptInput,
  b: PromptInput,
): number => {
  if (a.identifier === "input") return -1;
  if (b.identifier === "input") return 1;
  return a.identifier.localeCompare(b.identifier);
};

/**
 * Auto-detects template variables from prompt text and messages,
 * then merges them with explicitly provided inputs.
 *
 * - Extracts variables from the `prompt` field and all `messages[*].content`
 * - Explicit inputs preserve their type (e.g., "json" is not overwritten to "str")
 * - New auto-detected variables default to type "str"
 * - The locked "input" variable always sorts first
 * - Remaining inputs are sorted alphabetically for deterministic ordering
 */
export function mergeAutoDetectedInputs({
  prompt,
  messages,
  inputs,
}: {
  prompt: string;
  messages: Array<{ role: string; content: string }>;
  inputs: PromptInput[];
}): PromptInput[] {
  const detectedNames = detectTemplateVariables({ prompt, messages });

  // Merge: explicit inputs keep their type, auto-detected get "str"
  const mergedMap = new Map<string, LlmConfigInputType>();

  // Add all explicit inputs first
  for (const input of inputs) {
    mergedMap.set(input.identifier, input.type);
  }

  // Add auto-detected variables (only if not already present from explicit)
  for (const name of detectedNames) {
    if (!mergedMap.has(name)) {
      mergedMap.set(name, "str");
    }
  }

  // Convert to array and sort
  return Array.from(mergedMap.entries())
    .map(([identifier, type]) => ({ identifier, type }))
    .sort(byLockedInputThenAlphabetical);
}
