import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Schema & Types
// ─────────────────────────────────────────────────────────────────────────────

/** Zod schema for validating AI-generated scenario responses */
export const generatedScenarioSchema = z.object({
  name: z.string(),
  situation: z.string(),
  criteria: z.array(z.string()),
});

/**
 * Represents a generated scenario from the AI
 */
export type GeneratedScenario = z.infer<typeof generatedScenarioSchema>;

/** Serialized DomainError shape the generate endpoint attaches to handled failures */
const serializedDomainErrorSchema = z.object({
  kind: z.string(),
  meta: z.record(z.string(), z.unknown()).optional(),
});

/**
 * A handled generation failure with a stable `kind` discriminant
 * (e.g. "missing_provider") so the UI can react beyond showing the
 * message — see ScenarioAIGeneration's settings-link state.
 */
export class ScenarioGenerationError extends Error {
  constructor(
    message: string,
    public readonly kind: string,
    public readonly meta: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ScenarioGenerationError";
  }
}

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
    const domainError = serializedDomainErrorSchema.safeParse(
      error.domainError,
    );
    if (domainError.success) {
      throw new ScenarioGenerationError(
        error.error || "Failed to generate scenario",
        domainError.data.kind,
        domainError.data.meta,
      );
    }
    throw new Error(error.error || "Failed to generate scenario");
  }

  const data = await response.json();
  if (!data.scenario) {
    throw new Error("Invalid response: missing scenario data");
  }

  const parsed = generatedScenarioSchema.safeParse(data.scenario);
  if (!parsed.success) {
    throw new Error(`Invalid scenario data: ${parsed.error.message}`);
  }

  return parsed.data;
}
