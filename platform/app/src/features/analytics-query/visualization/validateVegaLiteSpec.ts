/**
 * The single entry point for deciding whether a Vega-Lite specification may be
 * rendered over a governed query result.
 *
 * The stages run in a deliberate order, each one bounding what the next has to
 * cope with:
 *
 *   1. dataset row ceilings  — about the data, and true whatever the spec says
 *   2. parsed-object check   — a URL or a scalar is never a specification
 *   3. `$schema` version     — an explicit non-v6 spec is refused, never converted
 *   4. size and depth        — so the schema validator is never handed something huge
 *   5. the bundled v6 schema — official, static, never fetched
 *   6. the governed policy   — data sources, resource paths, transforms, ceilings
 *   7. field references      — resolved against the dataset feeding each branch
 *
 * The caller's specification is never mutated or rewritten: on success,
 * `normalized` is the object that was handed in.
 */

import {
  type ColumnsByDataset,
  validateFieldReferences,
} from "./vegaLiteFields";
import {
  applyGovernedVegaPolicy,
  checkDatasetRowLimits,
  checkSpecEnvelopeLimits,
  governedVegaError,
} from "./vegaLitePolicy";
import {
  checkSchemaDeclaration,
  validateAgainstVegaLiteSchema,
} from "./vegaLiteSchema";
import { isPlainObject, JSON_POINTER_ROOT } from "./vegaLiteStructure";
import type {
  DatasetRowCounts,
  VegaLiteValidationResult,
  VegaValidationError,
  VegaValidationWarning,
} from "./visualization.types";

export interface ValidateVegaLiteSpecStructureInput {
  /** The already-parsed candidate specification. Never a URL, never text. */
  readonly spec: unknown;
  /** Every dataset name the spec may read. This list is the whole registry. */
  readonly registeredDatasets: readonly string[];
}

/**
 * Stages 2 to 6 — everything decidable from the specification alone.
 *
 * Split out because the two callers hold different amounts of the picture. The
 * renderer has rows and columns and asks {@link validateVegaLiteSpec} for all
 * seven stages. The save path holds a *query*, not its result, so the dataset
 * row ceilings and the field references are not yet facts about anything; it
 * asks for exactly this much on the way in, and the renderer asks for the rest
 * once rows exist. Neither re-implements a rule the other applies.
 */
export function validateVegaLiteSpecStructure({
  spec,
  registeredDatasets,
}: ValidateVegaLiteSpecStructureInput): VegaLiteValidationResult {
  if (!isPlainObject(spec)) return refused([notAnObjectError(spec)]);

  const version = checkSchemaDeclaration(spec);
  if (version.length > 0) return refused(version);

  const envelope = checkSpecEnvelopeLimits(spec);
  if (envelope.length > 0) return refused(envelope);

  const schema = validateAgainstVegaLiteSchema(spec);
  if (schema.length > 0) return refused(schema);

  const policy = applyGovernedVegaPolicy({ spec, registeredDatasets });
  if (policy.errors.length > 0) return refused(policy.errors, policy.warnings);

  return { ok: true, normalized: spec, warnings: policy.warnings };
}

export interface ValidateVegaLiteSpecInput {
  /** The already-parsed candidate specification. Never a URL, never text. */
  readonly spec: unknown;
  /** Columns of every dataset the spec may name. Its keys are the registry. */
  readonly columnsByDataset: ColumnsByDataset;
  /** Row counts of those datasets, checked against the row ceilings. */
  readonly rowCountsByDataset: DatasetRowCounts;
}

export function validateVegaLiteSpec({
  spec,
  columnsByDataset,
  rowCountsByDataset,
}: ValidateVegaLiteSpecInput): VegaLiteValidationResult {
  const rowLimits = checkDatasetRowLimits(rowCountsByDataset);
  if (rowLimits.length > 0) return refused(rowLimits);

  const structure = validateVegaLiteSpecStructure({
    spec,
    registeredDatasets: Object.keys(columnsByDataset),
  });
  if (!structure.ok) return structure;

  const fields = validateFieldReferences({ spec, columnsByDataset });
  const warnings = [...structure.warnings, ...fields.warnings];
  if (fields.errors.length > 0) return refused(fields.errors, warnings);

  return { ok: true, normalized: spec, warnings };
}

function refused(
  errors: readonly VegaValidationError[],
  warnings: readonly VegaValidationWarning[] = [],
): VegaLiteValidationResult {
  return { ok: false, errors, warnings };
}

function notAnObjectError(spec: unknown): VegaValidationError {
  return governedVegaError({
    rule: "spec.not-object",
    path: JSON_POINTER_ROOT,
    message: `A chart specification must be a JSON object, but this is ${describeValue(spec)}. A link to a specification is not accepted — paste the specification itself.`,
    meta: { received: describeValue(spec) },
  });
}

function describeValue(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return `a ${typeof value}`;
}

export type ParseVegaLiteSpecResult =
  | { readonly ok: true; readonly spec: unknown }
  | { readonly ok: false; readonly errors: readonly VegaValidationError[] };

/**
 * Parses specification text. Kept here so the one place that turns text into a
 * candidate specification also produces the `invalid-json` refusal, in the same
 * shape as every other refusal the chart layer renders.
 */
export function parseVegaLiteSpecText(text: string): ParseVegaLiteSpecResult {
  try {
    return { ok: true, spec: JSON.parse(text) };
  } catch (error) {
    return {
      ok: false,
      errors: [
        governedVegaError({
          rule: "spec.not-json",
          path: JSON_POINTER_ROOT,
          message: `The chart specification is not valid JSON: ${error instanceof Error ? error.message : "it could not be parsed"}.`,
        }),
      ],
    };
  }
}
