import { extractLiquidVariables, type PromptConfigFields } from "@langwatch/prompt-contract";

type LlmConfigInputType = NonNullable<PromptConfigFields["inputs"]>[number]["type"];

interface PromptInput {
  identifier: string;
  type: LlmConfigInputType;
}

/** Every template variable the prompt text and the messages name. */
function detectedVariableNames(
  prompt: string,
  messages: Array<{ role: string; content: string }>,
): Set<string> {
  const detected = new Set<string>();

  for (const text of [prompt, ...messages.map((message) => message.content)]) {
    if (!text) continue;

    for (const name of extractLiquidVariables(text).inputVariables) detected.add(name);
  }

  return detected;
}

/**
 * Auto-detected template variables merged with the explicit inputs. An explicit
 * input keeps its own type, a detected one defaults to "str", the locked
 * "input" variable sorts first and the rest sort alphabetically.
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
  const detectedNames = detectedVariableNames(prompt, messages);

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

  // Convert to array and sort: "input" first (locked variable), then alphabetically
  return Array.from(mergedMap.entries())
    .map(([identifier, type]) => ({ identifier, type }))
    .sort((a, b) => {
      if (a.identifier === "input") return -1;
      if (b.identifier === "input") return 1;
      return a.identifier.localeCompare(b.identifier);
    });
}
