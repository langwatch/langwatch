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

  // The endpoint answers with JSON on every outcome — 200 success and 4xx/5xx
  // error envelopes alike. A NON-JSON body therefore did not come from the
  // route handler; it came from a layer in FRONT of the app: a reverse-proxy
  // or gateway 502/504, an auth-redirect login page, a timeout error page, or
  // an older self-hosted build. Parsing it as JSON throws a raw
  // `Unexpected token '<', "<!DOCTYPE "...` that masks the real HTTP status and
  // strands the user — convert it into an actionable, status-bearing error
  // instead (langwatch#5758).
  let payload: { error?: string; domainError?: unknown; scenario?: unknown };
  try {
    payload = await response.json();
  } catch {
    const statusText = response.statusText ? ` ${response.statusText}` : "";
    throw new Error(
      `The server returned an unexpected response (HTTP ${response.status}${statusText}) instead of scenario data. This is usually temporary — please try again in a moment.`,
    );
  }

  if (!response.ok) {
    const domainError = serializedDomainErrorSchema.safeParse(
      payload.domainError,
    );
    if (domainError.success) {
      throw new ScenarioGenerationError(
        payload.error || "Failed to generate scenario",
        domainError.data.kind,
        domainError.data.meta,
      );
    }
    throw new Error(payload.error || "Failed to generate scenario");
  }

  if (!payload.scenario) {
    throw new Error("Invalid response: missing scenario data");
  }

  const parsed = generatedScenarioSchema.safeParse(payload.scenario);
  if (!parsed.success) {
    throw new Error(`Invalid scenario data: ${parsed.error.message}`);
  }

  return parsed.data;
}
