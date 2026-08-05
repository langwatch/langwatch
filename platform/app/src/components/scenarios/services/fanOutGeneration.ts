import { z } from "zod";
import { readHandledError } from "~/features/errors";

/**
 * Client for POST /api/scenario/fan-out/generate.
 *
 * Mirrors scenarioGeneration.ts's envelope handling: the endpoint always
 * answers with JSON, so a non-JSON body means a layer in FRONT of the app
 * answered (proxy 502/504, auth redirect, timeout page). Convert that into
 * an actionable, status-bearing error instead of a raw JSON parse crash.
 */

export const FAN_OUT_LENS_LABELS: Record<string, string> = {
  paraphrase: "Paraphrase",
  entity_substitution: "Different details",
  tone_shift: "Different tone",
  adjacent_intent: "Related request",
  boundary_value: "Edge case",
  multi_turn_context_variation: "Different path",
};

const generatedVariantSchema = z.object({
  id: z.string(),
  batchId: z.string(),
  scenarioId: z.string(),
  lens: z.string(),
  rationale: z.string().nullable(),
  status: z.string(),
});

const responseSchema = z.object({
  batchId: z.string(),
  status: z.string(),
  variants: z.array(generatedVariantSchema),
});

export type GeneratedFanOutVariant = z.infer<typeof generatedVariantSchema>;
export type FanOutGenerationResult = z.infer<typeof responseSchema>;

/**
 * A named failure the generate endpoint reported.
 *
 * `kind` is the handled `code`, which is what picks both the recovery and the
 * copy: `classifyGenerationError` keys off it and the words come from the
 * code-keyed registry, so nothing user-facing is authored here.
 */
export class FanOutGenerationError extends Error {
  constructor(
    message: string,
    public readonly kind: string,
    public readonly meta: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "FanOutGenerationError";
  }
}

export type FanOutTarget = {
  type: "prompt" | "http" | "code" | "workflow";
  referenceId: string;
};

export type FanOutSeed =
  | { type: "SCENARIO_RUN"; scenarioId: string; scenarioRunId: string }
  | { type: "FREE_TEXT"; description: string };

export async function generateAdjacentScenarios({
  projectId,
  seed,
  target,
  count,
}: {
  projectId: string;
  seed: FanOutSeed;
  target: FanOutTarget;
  count?: number;
}): Promise<FanOutGenerationResult> {
  const response = await fetch("/api/scenario/fan-out/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, seed, target, count }),
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    const statusText = response.statusText ? ` ${response.statusText}` : "";
    throw new Error(
      `The server returned an unexpected response (HTTP ${response.status}${statusText}). This is usually temporary, please try again in a moment.`,
    );
  }

  if (!response.ok) {
    // The endpoint throws its handled errors, so a failure arrives as the flat
    // REST envelope the secured app serializes: the code in `error`, the meta
    // spread alongside it.
    const handled = readHandledError(payload);
    if (handled) {
      throw new FanOutGenerationError(handled.code, handled.code, handled.meta);
    }
    throw new Error("Could not generate adjacent scenarios");
  }

  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Unexpected response: ${parsed.error.message}`);
  }

  return parsed.data;
}
