import type { z } from "zod";

import { evaluatorsSchema } from "./evaluators.generated.ts";

type SettingsSchema = z.ZodType<Record<string, unknown>, Record<string, unknown>>;

const settingsSchemas: Readonly<Record<string, SettingsSchema>> = Object.fromEntries(
  Object.entries(evaluatorsSchema.shape).map(([type, schema]) => [type, schema.shape.settings]),
);

/** A built-in evaluator's settings schema; custom and retired evaluators have none. */
export type EvaluatorSettingsSchemaLookup =
  | { found: true; schema: SettingsSchema }
  | { found: false };

export function evaluatorSettingsSchemaFor(checkType: string): EvaluatorSettingsSchemaLookup {
  const schema = settingsSchemas[checkType];
  return schema ? { found: true, schema } : { found: false };
}
