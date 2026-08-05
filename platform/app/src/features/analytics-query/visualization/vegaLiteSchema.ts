/**
 * Schema validation against the official Vega-Lite v6 JSON Schema that ships
 * inside the `vega-lite` package.
 *
 * The schema is a static import, so it is part of the chart chunk and nothing
 * is ever fetched: a validator that reached the network to learn what is valid
 * would be a resource-loading path of its own.
 *
 * ⚠ Ajv compiles a schema by building a function at runtime, which needs
 * `unsafe-eval`. The deployed Content-Security-Policy carries it for unrelated
 * scripts; if it is ever dropped, this module has to move to Ajv's standalone
 * (build-time) code generation, and only this module does.
 */

import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

import vegaLiteSchemaJson from "vega-lite/vega-lite-schema.json";
import { governedVegaError } from "./vegaLitePolicy";
import { JSON_POINTER_ROOT } from "./vegaLiteStructure";
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

let compiled: ValidateFunction | null = null;

/**
 * Compiles the schema on first use and keeps it. Compilation costs well over a
 * second, so it must not happen per keystroke — and it must not happen at module
 * load either, or importing the validator would cost that much on the server.
 */
export function getVegaLiteSchemaValidator(): ValidateFunction {
  if (compiled === null) {
    const ajv = new Ajv({
      // The Vega-Lite schema is draft-07 and uses union types and keywords Ajv
      // would otherwise refuse to compile.
      strict: false,
      // Every branch, because one root-level "must match a schema in anyOf" is
      // not a repairable message. Bounded by the size and depth ceilings, which
      // refuse an oversized spec before it ever reaches here.
      allErrors: true,
      // The schema declares `color-hex`, which is not a JSON Schema format.
      validateFormats: false,
    });
    compiled = ajv.compile(vegaLiteSchemaJson);
  }
  return compiled;
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
