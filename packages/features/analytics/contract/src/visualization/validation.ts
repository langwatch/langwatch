/**
 * Server-side admission path for saved chart definitions.
 *
 * It is deliberately a separate export from the browser visualization entry:
 * loading the generated validator is valid while a chart is saved, but must
 * not make an ordinary browser import of theme/policy helpers eager.
 */
export * from "./lwql-dataset-names";
export * from "./validate-vega-lite-spec";
export * from "./vega-lite-schema";
export type { VegaValidationError } from "./visualization-types";
