/**
 * Server-side admission path for saved chart definitions.
 *
 * It is deliberately a separate export from the browser visualization entry:
 * loading the generated validator is valid while a chart is saved, but must
 * not make an ordinary browser import of theme/policy helpers eager.
 */
export * from "./lwql-dataset-names.ts";
export * from "./validate-vega-lite-spec.ts";
export * from "./vega-lite-schema.ts";
export type { VegaValidationError } from "./visualization-types.ts";
