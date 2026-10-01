/**
 * Server-side admission path for saved chart definitions. Deliberately
 * separate from the browser visualization entry, so loading the generated
 * validator never makes an ordinary browser import eager.
 */
export * from "./lwql-dataset-names.ts";
export * from "./validate-vega-lite-spec.ts";
export * from "./vega-lite-schema.ts";
export type { VegaValidationError } from "./visualization-types.ts";
