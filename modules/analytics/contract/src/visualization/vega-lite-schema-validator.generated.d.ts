/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Regenerate with `pnpm generate:vega-validator`.
 *
 * The generated validator is plain JavaScript; this is the shape Ajv's
 * standalone output actually has, declared so the chart layer keeps its
 * types without the 7 MB of generated code entering the type graph.
 */

import type { ErrorObject } from "ajv";

export interface VegaLiteSchemaValidator {
  (data: unknown): boolean;
  errors?: ErrorObject[] | null;
}

export declare const validate: VegaLiteSchemaValidator;
export default validate;
