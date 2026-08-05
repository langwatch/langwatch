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
  readonly kind: string;
  readonly meta: Record<string, unknown>;
  /**
   * The support handle from the response envelope. Carried because this is a
   * plain client error that `readHandledError` cannot recognise, so without it
   * the trace id the server went to the trouble of attaching is dropped before
   * anything can show it.
   */
  readonly traceId: string | undefined;

  constructor({
    message,
    kind,
    meta = {},
    traceId,
  }: {
    message: string;
    kind: string;
    meta?: Record<string, unknown>;
    traceId?: string;
  }) {
    super(message);
    this.name = "FanOutGenerationError";
    this.kind = kind;
    this.meta = meta;
    this.traceId = traceId;
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
  // The server stops its own model calls at 60s, so a request still open well
  // past that is the connection hanging rather than generation being slow.
  // Without this the modal spins until the user gives up.
  const response = await fetch("/api/scenario/fan-out/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, seed, target, count }),
    signal: AbortSignal.timeout(120_000),
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
      throw new FanOutGenerationError({
        message: handled.code,
        kind: handled.code,
        meta: handled.meta,
        traceId: handled.traceId,
      });
    }
    throw new Error("Could not generate adjacent scenarios");
  }

  const parsed = responseSchema.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`Unexpected response: ${parsed.error.message}`);
  }

  return parsed.data;
}
