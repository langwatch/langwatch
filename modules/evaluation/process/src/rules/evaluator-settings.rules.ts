import type { z } from "zod";

/** The generation parameters an evaluator's judge model may carry: main's whitelist. */
const GENERATION_PARAM_KEYS = [
  "temperature",
  "max_tokens",
  "top_p",
  "frequency_penalty",
  "presence_penalty",
  "seed",
  "reasoning_effort",
] as const;

/** The whitelisted generation parameters in these settings; absent and null ones stay absent. */
export function pickGenerationParams(
  settings: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  if (!settings) return {};
  return Object.fromEntries(
    GENERATION_PARAM_KEYS.flatMap((key) =>
      settings[key] === undefined || settings[key] === null ? [] : [[key, settings[key]]],
    ),
  );
}

/**
 * Settings parsed by the evaluator's own schema, with the generation parameters the parse
 * would drop put back. Throws the schema's error when the settings are invalid.
 */
export function parseDispatchSettings({
  schema,
  settings,
}: {
  schema: z.ZodType<Record<string, unknown>> | undefined;
  settings: Record<string, unknown>;
}): Record<string, unknown> | undefined {
  if (!schema) return undefined;
  return { ...pickGenerationParams(settings), ...schema.parse(settings) };
}
