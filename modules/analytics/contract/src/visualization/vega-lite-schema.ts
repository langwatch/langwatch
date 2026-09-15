/**
 * Schema validation against Vega-Lite v6. Validator is generated ahead of time
 * (not runtime-compiled) for CSP compliance, so nothing is fetched.
 */

import type { ErrorObject } from "ajv";

import { lwqlVegaError } from "./vega-lite-policy.ts";
import vegaLiteSchemaValidator, {
  type VegaLiteSchemaValidator,
} from "./vega-lite-schema-validator.generated.js";
import { isPlainObject, JSON_POINTER_ROOT } from "./vega-lite-structure.ts";
import type { VegaValidationError } from "./visualization-types.ts";

/** The canonical `$schema` for the supported version. */
export const VEGA_LITE_SCHEMA_URL = "https://vega.github.io/schema/vega-lite/v6.json";

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
  if (declared === void 0) return true;
  return typeof declared === "string" && SUPPORTED_SCHEMA_URL.test(declared);
}

/**
 * Refuses an explicit `$schema` that is not Vega-Lite v6. An absent `$schema` is
 * accepted and read as v6; a present one is never rewritten to v6, because
 * silently reinterpreting a v5 spec as v6 changes what it draws.
 */
export function checkSchemaDeclaration(spec: Record<string, unknown>): VegaValidationError[] {
  const declared = spec.$schema;
  if (isSupportedSchemaDeclaration(declared)) return [];

  return [
    lwqlVegaError({
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
  const reported = mostSpecificErrors(validate.errors ?? []).map(toValidationError);
  // A refusal with no reported errors must not read as an acceptance. Ajv can
  // return `false` with `errors` null or empty, and `mostSpecificErrors` takes
  // `Math.max` over that empty pool — `-Infinity`, which nothing matches — so
  // returning it directly would hand the caller zero errors for a spec the
  // schema rejected. This runtime is fail-closed: say so generically instead.
  if (reported.length === 0) {
    return [
      lwqlVegaError({
        rule: "spec.schema-invalid",
        path: JSON_POINTER_ROOT,
        message: "This chart specification does not match the Vega-Lite v6 schema.",
      }),
    ];
  }
  return reported;
}

/**
 * Keeps errors at the deepest instance path (JSON Pointer segments, not
 * character length), drops anyOf/oneOf wrappers.
 */
function pointerDepth(error: ErrorObject): number {
  return error.instancePath === "" ? 0 : error.instancePath.split("/").length - 1;
}

function mostSpecificErrors(errors: readonly ErrorObject[]): ErrorObject[] {
  const concrete = errors.filter(
    (error) => !["anyOf", "oneOf", "if", "not"].includes(error.keyword),
  );
  const pool = concrete.length > 0 ? concrete : [...errors];
  const deepest = Math.max(...pool.map(pointerDepth));

  const seen = new Set<string>();
  return pool
    .filter((error) => pointerDepth(error) === deepest)
    .filter((error) => {
      const key = `${error.instancePath}|${error.keyword}|${error.message ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_REPORTED_SCHEMA_ERRORS);
}

function toValidationError(error: ErrorObject): VegaValidationError {
  const path = error.instancePath === "" ? JSON_POINTER_ROOT : error.instancePath;
  return lwqlVegaError({
    rule: "spec.schema-invalid",
    path,
    message: `${path} ${error.message ?? "is not valid"}${detailOf(error)}.`,
    meta: { keyword: error.keyword, params: error.params },
  });
}

/** Turns Ajv's `params` into the part of the message that says what to write. */
function detailOf(error: ErrorObject): string {
  const params = isPlainObject(error.params) ? error.params : {};
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
