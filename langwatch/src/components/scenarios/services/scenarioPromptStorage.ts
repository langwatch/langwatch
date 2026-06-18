/**
 * Session storage utilities for passing the AI generation prompt
 * from the AICreateModal to the ScenarioAIGeneration component.
 */

export const SCENARIO_AI_PROMPT_KEY = "scenario_ai_prompt";

export function storePromptForScenario(prompt: string): void {
  try {
    sessionStorage.setItem(SCENARIO_AI_PROMPT_KEY, prompt);
  } catch {
    // sessionStorage may be unavailable (SSR, private mode, etc.)
  }
}

export function consumeStoredPrompt(): string | null {
  try {
    const prompt = sessionStorage.getItem(SCENARIO_AI_PROMPT_KEY);
    sessionStorage.removeItem(SCENARIO_AI_PROMPT_KEY);
    return prompt && prompt.trim() !== "" ? prompt : null;
  } catch {
    return null;
  }
}
