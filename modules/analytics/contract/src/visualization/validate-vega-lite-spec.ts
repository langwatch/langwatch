/**
 * Single entry point for validating whether a Vega-Lite specification may
 * render over a LangWatchQL result. Runs 7 validation stages in order. Never
 * mutates the caller's spec.
 */

import { type ColumnsByDataset, validateFieldReferences } from "./vega-lite-fields.ts";
import {
  applyLangWatchQLVegaPolicy,
  checkDatasetRowLimits,
  checkSpecEnvelopeLimits,
  lwqlVegaError,
} from "./vega-lite-policy.ts";
import { checkSchemaDeclaration, validateAgainstVegaLiteSchema } from "./vega-lite-schema.ts";
import { isPlainObject, JSON_POINTER_ROOT } from "./vega-lite-structure.ts";
import type {
  DatasetRowCounts,
  VegaLiteValidationResult,
  VegaValidationError,
  VegaValidationWarning,
} from "./visualization-types.ts";

export interface ValidateVegaLiteSpecStructureInput {
  /** The already-parsed candidate specification. Never a URL, never text. */
  readonly spec: unknown;
  /** Every dataset name the spec may read. This list is the whole registry. */
  readonly registeredDatasets: readonly string[];
}

/**
 * Stages 2-6 of validation (spec-alone). Split out because renderer validates
 * all seven stages, save path validates only these before rows exist.
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

  const policy = applyLangWatchQLVegaPolicy({ spec, registeredDatasets });
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
  return lwqlVegaError({
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
        lwqlVegaError({
          rule: "spec.not-json",
          path: JSON_POINTER_ROOT,
          message: `The chart specification is not valid JSON: ${error instanceof Error ? error.message : "it could not be parsed"}.`,
        }),
      ],
    };
  }
}
