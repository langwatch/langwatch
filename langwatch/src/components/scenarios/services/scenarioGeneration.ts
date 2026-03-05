// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents a generated scenario from the AI
 */
export type GeneratedScenario = {
  name: string;
  situation: string;
  criteria: string[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a scenario using AI.
 *
 * Calls the /api/scenario/generate endpoint with the given prompt and optional
 * current scenario for refinement.
 *
 * @param prompt - The user's description of the scenario to generate
 * @param projectId - The project ID to generate the scenario for
 * @param currentScenario - Optional existing scenario data for refinement
 * @returns The generated scenario data
 * @throws Error if the API call fails or returns invalid data
 */
export async function generateScenarioWithAI(
  prompt: string,
  projectId: string,
  currentScenario?: GeneratedScenario | null
): Promise<GeneratedScenario> {
  const response = await fetch("/api/scenario/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      currentScenario: currentScenario ?? null,
      projectId,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to generate scenario");
  }

  const data = await response.json();
  if (!data.scenario) {
    throw new Error("Invalid response: missing scenario data");
  }

  return data.scenario;
}
