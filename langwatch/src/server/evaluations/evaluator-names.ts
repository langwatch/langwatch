/**
 * Evaluator name mapping for display purposes
 * Maps internal evaluator names to user-friendly display names
 */
export const evaluatorNameMap: Record<string, string> = {
  "Azure Content Safety": "Content Safety",
  "OpenAI Moderation": "Moderation",
  "Azure Jailbreak Detection": "Jailbreak Detection",
  "Presidio PII Detection": "PII Detection",
  "Lingua Language Detection": "Language Detection",
  "Azure Prompt Shield": "Prompt Injection Detection",
};

/**
 * Get the display name for an evaluator
 * @param name - The internal evaluator name
 * @returns The display name or the original name if no mapping exists
 */
export function getEvaluatorDisplayName(name: string): string {
  return evaluatorNameMap[name] ?? name;
}
