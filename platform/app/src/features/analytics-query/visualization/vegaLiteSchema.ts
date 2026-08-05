/**
 * Schema validation against the official Vega-Lite v6 JSON Schema that ships
 * inside the `vega-lite` package.
 *
 * The validator is *generated* from that schema ahead of time and checked in
 * (`vegaLiteSchemaValidator.generated.js`, written by
 * `scripts/generate-vega-lite-validator.ts`). Ajv's runtime compiler builds its
 * validate function with `new Function`, which a Content-Security-Policy
 * without `unsafe-eval` refuses — the very policy the chart runtime is built to
 * survive. Generating ahead of time moves that one `new Function` call to a
 * developer's machine, so the browser loads code that already exists.
 *
 * It also means nothing is ever fetched, and the 1.9 MB schema document itself
 * never reaches the browser: a validator that reached the network to learn what
 * is valid would be a resource-loading path of its own.
 */

import type { ErrorObject } from "ajv";

import { governedVegaError } from "./vegaLitePolicy";
import { JSON_POINTER_ROOT } from "./vegaLiteStructure";
import vegaLiteSchemaValidator, {
  type VegaLiteSchemaValidator,
} from "./vegaLiteSchemaValidator.generated.js";
import type { VegaValidationError } from "./visualization.types";

/** The canonical `$schema` for the supported version. */
export const VEGA_LITE_SCHEMA_URL =
  "https://vega.github.io/schema/vega-lite/v6.json";

/**
 * `$schema` values that mean "Vega-Lite v6": the canonical URL, and the patch-
 * pinned forms editors write. Nothing else is accepted, and nothing is rewritten.
 */
const SUPPORTED_SCHEMA_URL =
  /^https?:\/\/vega\.github\.io\/schema\/vega-lite\/v6(\.\d+){0,2}\.json$/;

/**
 * How many schema errors a refusal carries. Ajv reports every branch of the
 * schema's `anyOf` trees, which runs to hundreds for one mistake; the deepest
 * few are the ones that name the property to fix.
 */
const MAX_REPORTED_SCHEMA_ERRORS = 5;

/**
 * The generated validator. There is nothing to compile and nothing to cache:
 * the function was built when the module was generated, so the first keystroke
 * costs the same as the thousandth.
 */
export function getVegaLiteSchemaValidator(): VegaLiteSchemaValidator {
  return vegaLiteSchemaValidator;
}

/** True when `$schema` is absent (treated as v6) or names Vega-Lite v6. */
export function isSupportedSchemaDeclaration(declared: unknown): boolean {
  if (declared === undefined) return true;
  return typeof declared === "string" && SUPPORTED_SCHEMA_URL.test(declared);
}

/**
 * Refuses an explicit `$schema` that is not Vega-Lite v6. An absent `$schema` is
 * accepted and read as v6; a present one is never rewritten to v6, because
 * silently reinterpreting a v5 spec as v6 changes what it draws.
 */
export function checkSchemaDeclaration(
  spec: Record<string, unknown>,
): VegaValidationError[] {
  const declared = spec.$schema;
  if (isSupportedSchemaDeclaration(declared)) return [];

  return [
    governedVegaError({
      rule: "spec.unsupported-schema-version",
      path: `${JSON_POINTER_ROOT}$schema`,
      message: `This chart specification declares ${JSON.stringify(declared)}. Only Vega-Lite v6 is supported — set "$schema" to ${VEGA_LITE_SCHEMA_URL} and adjust the specification, or remove it.`,
      meta: { declared, supported: VEGA_LITE_SCHEMA_URL },
    }),
  ];
}

/** Validates against the bundled schema, reporting the most specific failures. */
export function validateAgainstVegaLiteSchema(
  spec: Record<string, unknown>,
): VegaValidationError[] {
  const validate = getVegaLiteSchemaValidator();
  if (validate(spec)) return [];
  return mostSpecificErrors(validate.errors ?? []).map(toValidationError);
}

/**
 * Keeps the errors with the longest instance path — the ones that point at a
 * property rather than at the whole document — and drops the `anyOf`/`oneOf`
 * wrappers that only say a branch failed.
 */
function mostSpecificErrors(errors: readonly ErrorObject[]): ErrorObject[] {
  const concrete = errors.filter(
    (error) => !["anyOf", "oneOf", "if", "not"].includes(error.keyword),
  );
  const pool = concrete.length > 0 ? concrete : [...errors];
  const deepest = Math.max(...pool.map((error) => error.instancePath.length));

  const seen = new Set<string>();
  return pool
    .filter((error) => error.instancePath.length === deepest)
    .filter((error) => {
      const key = `${error.instancePath}|${error.keyword}|${error.message ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_REPORTED_SCHEMA_ERRORS);
}

function toValidationError(error: ErrorObject): VegaValidationError {
  const path =
    error.instancePath === "" ? JSON_POINTER_ROOT : error.instancePath;
  return governedVegaError({
    rule: "spec.schema-invalid",
    path,
    message: `${path} ${error.message ?? "is not valid"}${detailOf(error)}.`,
    meta: { keyword: error.keyword, params: error.params },
  });
}

/** Turns Ajv's `params` into the part of the message that says what to write. */
function detailOf(error: ErrorObject): string {
  const params = error.params as Record<string, unknown>;
  if (Array.isArray(params.allowedValues)) {
    return `: ${params.allowedValues.join(", ")}`;
  }
  if (typeof params.additionalProperty === "string") {
    return `: remove "${params.additionalProperty}"`;
  }
  if (typeof params.missingProperty === "string") {
    return `: add "${params.missingProperty}"`;
  }
  return "";
}
