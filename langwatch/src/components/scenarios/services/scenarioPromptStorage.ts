/**
 * Session storage utilities for passing the AI generation prompt
 * from the AICreateModal to the ScenarioAIGeneration component.
 *
 * The prompt is stored when generation succeeds and consumed (read + deleted)
 * when the scenario editor loads.
 */

export const SCENARIO_AI_PROMPT_KEY = "scenario_ai_prompt";

/**
 * Stores a prompt in sessionStorage for later retrieval by the scenario editor.
 * Called when AI generation succeeds and user navigates to the editor.
 */
export function storePromptForScenario(prompt: string): void {
  try {
    sessionStorage.setItem(SCENARIO_AI_PROMPT_KEY, prompt);
  } catch {
    // sessionStorage may be unavailable (SSR, private mode, etc.)
    // Silently fail - the prompt will not be shown in history
  }
}

/**
 * Reads and clears the stored prompt from sessionStorage.
 * Returns null if no prompt exists or sessionStorage is unavailable.
 *
 * This is a one-time consumption - calling this function clears the stored value.
 */
export function consumeStoredPrompt(): string | null {
  try {
    const prompt = sessionStorage.getItem(SCENARIO_AI_PROMPT_KEY);
    sessionStorage.removeItem(SCENARIO_AI_PROMPT_KEY);

    // Treat empty string as no prompt
    return prompt && prompt.trim() !== "" ? prompt : null;
  } catch {
    // sessionStorage may be unavailable (SSR, private mode, etc.)
    return null;
  }
}
