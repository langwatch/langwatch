/**
 * The built-in evaluator catalogue `GET /api/evaluations/list` answers with.
 *
 * Each entry carries `settings_json_schema`: the JSON Schema of that
 * evaluator's settings object, which is what a caller renders the settings
 * form from. It must describe every setting — its type, its default, its
 * prose and its permitted values — or the form has nothing to draw.
 *
 * The schema is derived with zod's own `toJSONSchema`. `zod-to-json-schema`
 * reads zod 3 internals and answers `{ "$schema": … }` and nothing else for a
 * zod 4 schema, which is a silently empty catalogue rather than a failure.
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
 * One evaluator's settings schema, as JSON Schema.
 *
 * `io: "input"` is what a settings FORM needs: a setting with a default is
 * optional to supply, not required. `unrepresentable: "any"` keeps one exotic
 * setting from emptying the whole catalogue.
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
 * Rewrites `anyOf` of single-value schemas back into `enum`.
 *
 * A zod union of literals is one setting with a fixed list of choices, and
 * `enum` is how this endpoint has always published it — a renderer that only
 * understands `enum` draws a select box where it would otherwise draw nothing.
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
