/**
 * Built-in evaluator catalogue with settings_json_schema for each evaluator,
 * derived via zod's toJSONSchema.
 */
import {
  AVAILABLE_EVALUATORS,
  evaluatorDisplayName,
  evaluatorsSchema,
} from "@langwatch/evaluator-contract";
import { z } from "zod";

/**
 * Evaluators the catalogue does not advertise: the documentation examples, and
 * two cloud detectors this door has never listed.
 */
function isPublishedEvaluator(key: string): boolean {
  return (
    !key.startsWith("example/") &&
    key !== "aws/comprehend_pii_detection" &&
    key !== "google_cloud/dlp_pii_detection"
  );
}

/**
 * One evaluator's settings schema, as JSON Schema. `io: "input"` marks a
 * setting with a default as optional rather than required for a settings
 * FORM; `unrepresentable: "any"` keeps one exotic setting from emptying the catalogue.
 */
export function evaluatorSettingsJsonSchema(key: string): Record<string, unknown> {
  const settings =
    // @ts-expect-error `key` indexes the union of every evaluator type, so
    // `.shape.settings` resolves to a heterogeneous union that resolves at
    // runtime but TypeScript cannot narrow.
    evaluatorsSchema.shape[key]?.shape.settings as z.ZodType | undefined;
  if (!settings) return {};
  const schema = z.toJSONSchema(settings, { io: "input", unrepresentable: "any" });
  return withEnumerations(schema) as Record<string, unknown>;
}

/**
 * Rewrites `anyOf` of single-value schemas back into `enum` — a zod union of
 * literals is one setting with fixed choices, and `enum` is how this endpoint
 * has always published it, so an `enum`-only renderer still draws a select box.
 */
function withEnumerations(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(withEnumerations);
  if (typeof node !== "object" || node === null) return node;

  const rewritten = Object.fromEntries(
    Object.entries(node as Record<string, unknown>).map(([key, value]) => [
      key,
      withEnumerations(value),
    ]),
  );

  const branches = rewritten.anyOf;
  if (!Array.isArray(branches) || branches.length === 0) return rewritten;

  const constants: unknown[] = [];
  const types = new Set<unknown>();
  for (const branch of branches) {
    if (typeof branch !== "object" || branch === null) return rewritten;
    const entries = branch as Record<string, unknown>;
    if (!("const" in entries)) return rewritten;
    const keys = Object.keys(entries).filter((name) => name !== "const" && name !== "type");
    if (keys.length > 0) return rewritten;
    constants.push(entries.const);
    types.add(entries.type);
  }

  const { anyOf: _replaced, ...rest } = rewritten;
  return {
    ...rest,
    ...(types.size === 1 && [...types][0] !== undefined ? { type: [...types][0] } : {}),
    enum: constants,
  };
}

/**
 * The whole catalogue, keyed by the evaluator id a caller puts in the evaluate
 * path.
 */
export function buildEvaluatorCatalogue(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(AVAILABLE_EVALUATORS)
      .filter(([key]) => isPublishedEvaluator(key))
      .map(([key, value]) => [
        key,
        {
          ...value,
          name: evaluatorDisplayName(value.name),
          settings_json_schema: evaluatorSettingsJsonSchema(key),
        },
      ]),
  );
}
